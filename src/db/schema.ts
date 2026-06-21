import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  real,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * The lifecycle of a single shipment line through the pipeline.
 * This is a state machine — every Inngest step transitions it, and the
 * customer dashboard + review queue are just filtered views of this column.
 *
 *   received → processing → ( cleared | needs_review | blocked ) | failed
 *
 * `needs_review` and `blocked` are the two outcomes that protect the customer
 * from a silent wrong classification — the core thesis of the project.
 */
export const shipmentStatus = pgEnum("shipment_status", [
  "received",
  "processing",
  "needs_review",
  "cleared",
  "blocked",
  "failed",
]);

/** Where the final HS code came from. Drives the accuracy/automation metric. */
export const classificationSource = pgEnum("classification_source", [
  "auto", // confidence high enough to clear without a human
  "human", // a reviewer picked from the AI's candidates
  "cache", // reused a previous classification for the same SKU
]);

/** One customer import — a CSV upload or an API batch. */
export const batches = pgTable("batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source").notNull(), // 'csv' | 'api'
  customerId: text("customer_id").notNull(),
  itemCount: integer("item_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * One parcel line item to clear. Holds the raw input as received (deliberately
 * kept — real marketplace titles are dirty and we must be able to re-process),
 * plus the *current* resolved result for fast dashboard queries. The full story
 * of how we got here lives in `classifications` and `auditLog`.
 */
export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .references(() => batches.id)
      .notNull(),

    // --- INPUT (step 0: ingest) ---
    externalRef: text("external_ref"), // customer's own SKU / order id
    rawTitle: text("raw_title").notNull(), // "Cute Cat Hoodie Soft Warm XL Gift"
    rawDescription: text("raw_description"),
    normalizedTitle: text("normalized_title"), // cleaned, post step-1
    declaredValue: numeric("declared_value", { precision: 12, scale: 2 }),
    currency: text("currency"),
    originCountry: text("origin_country"), // ISO-2, e.g. 'CN'
    destinationCountry: text("destination_country"), // 'JP'
    quantity: integer("quantity").default(1),
    material: text("material"), // often the deciding fact, often missing

    // --- RESOLVED RESULT (filled as the pipeline runs) ---
    hsCode: text("hs_code"), // step 2: classification
    hsConfidence: real("hs_confidence"), // 0..1, drives routing
    classificationSource: classificationSource("classification_source"),
    dutyAmount: numeric("duty_amount", { precision: 12, scale: 2 }), // step 4
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }), // step 5
    totalLandedCost: numeric("total_landed_cost", { precision: 12, scale: 2 }),
    complianceFlags: jsonb("compliance_flags").$type<ComplianceFlag[]>().default([]), // step 6

    status: shipmentStatus("status").notNull().default("received"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("shipments_status_idx").on(t.status), // review queue & dashboard filters
    index("shipments_batch_idx").on(t.batchId),
  ],
);

/**
 * Every AI attempt at classifying a shipment — kept as history, never
 * overwritten. We store the full top-3 `candidates` (not just the chosen code)
 * because the whole product thesis is that top-3 ≈ 79% while top-1 ≈ 59%: the
 * router and the human reviewer both need the alternatives. Re-classifying after
 * a model upgrade appends a new row, so we can measure improvement over time.
 */
export const classifications = pgTable(
  "classifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shipmentId: uuid("shipment_id")
      .references(() => shipments.id)
      .notNull(),
    candidates: jsonb("candidates").$type<Candidate[]>().notNull(), // top-3, best first
    chosenHsCode: text("chosen_hs_code"),
    confidence: real("confidence"),
    model: text("model").notNull(), // 'claude-sonnet-4-6'
    promptVersion: text("prompt_version").notNull(), // 'v2' from the eval study
    inputTokens: integer("input_tokens").default(0),
    outputTokens: integer("output_tokens").default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("classifications_shipment_idx").on(t.shipmentId)],
);

/**
 * Human-in-the-loop. A reviewer picks one of the AI's candidates (or overrides
 * with their own). This is both the safety net and the training-data factory:
 * every review is a labelled example we can later evaluate prompts against.
 */
export const reviews = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  shipmentId: uuid("shipment_id")
    .references(() => shipments.id)
    .notNull(),
  reviewer: text("reviewer").notNull(),
  chosenHsCode: text("chosen_hs_code").notNull(),
  pickedFromCandidates: text("picked_from_candidates"), // 'yes' | 'override'
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Append-only audit trail. A compliance product must be able to prove *why* a
 * code was assigned and who/what assigned it — a silent overwrite is exactly the
 * failure mode we are protecting against. Nothing here is ever updated.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shipmentId: uuid("shipment_id")
      .references(() => shipments.id)
      .notNull(),
    actor: text("actor").notNull(), // 'system:classifier' | 'system:router' | 'user:dat'
    action: text("action").notNull(), // 'classified' | 'routed' | 'reviewed' | 'cleared'
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_shipment_idx").on(t.shipmentId)],
);

/**
 * Classification cache — the single biggest cost lever at scale: the same product
 * ships thousands of times, so we classify it once and reuse.
 *
 * Keyed by a **content hash**, NOT by SKU and NOT by a uuid:
 *  - SKU is a per-merchant namespace — merchant A's "SHIRT-001" and merchant B's
 *    "SHIRT-001" can be different things, so caching on SKU would collide.
 *  - A uuid is unique but random — you can't re-derive it from a product, so you
 *    could never look the product up. A content hash is deterministic: the same
 *    product always hashes to the same key, so the key *is* the lookup. (One-way
 *    is fine — we never decode it, we recompute it from fresh input.)
 *
 * Two merchants selling the *same* product legitimately share a classification;
 * the same SKU string for *different* products hashes differently and won't hit.
 *
 * NOTE on the key: `normalizedTitle` is produced by **deterministic rule-based
 * cleanup (lowercase, strip punctuation/marketing fluff) — never an LLM**, because
 * a cache key must be reproducible and an LLM is stochastic. Normalization is kept
 * conservative on purpose: a cache *miss* is harmless (we just classify again), a
 * false *hit* is the danger. Unifying differently-worded-but-same products is a
 * later pgvector/embedding upgrade with its own threshold tradeoff.
 *
 * NOTE on staleness: a cached entry was produced by a specific model + prompt, so
 * we stamp `model`/`promptVersion`. On a model upgrade we either version the key
 * with them or invalidate, so we never serve an old model's answer as current.
 */
export const classificationCache = pgTable("classification_cache", {
  key: text("key").primaryKey(), // hash(normalizedTitle + destinationCountry)
  hsCode: text("hs_code").notNull(),
  candidates: jsonb("candidates").$type<Candidate[]>().notNull(),
  confidence: real("confidence"),
  model: text("model"), // which model produced this — guards against stale cache
  promptVersion: text("prompt_version"),
  hits: integer("hits").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- JSONB payload shapes (typed at the app layer, not enforced by Postgres) ---

export interface Candidate {
  hsCode: string; // e.g. '6202' (heading) or '6202.40.7000' (full)
  label?: string;
  reasoning?: string;
  score?: number; // model's own confidence for this candidate, 0..1
}

export interface ComplianceFlag {
  type: "restricted" | "prohibited" | "license_required" | "denied_party" | "de_minimis";
  severity: "info" | "warn" | "block";
  message: string;
}
