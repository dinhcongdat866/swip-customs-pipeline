# SWIP Customs Pipeline — System Design

A production-shaped slice of a cross-border customs compliance pipeline. It turns
the offline eval study in [`hs-code-classifier`](../hs-code-classifier) into a
real workflow: ingest product data → classify → assess duty/tax/compliance →
route by confidence → human-in-the-loop review → cleared declaration.

> Built to match SWIP's stack (Next.js · TypeScript · Postgres/Supabase ·
> Inngest · Anthropic) and to make the tradeoffs in my written exercise concrete
> in code rather than prose.

## The problem in one frame

Every parcel crossing a border needs a valid customs declaration. SWIP takes raw
product data from marketplaces/carriers/merchants and returns that declaration —
classified, duty-and-tax assessed, compliance-checked — **fast, accurate, cheap,
at the scale of millions of parcels.** Success = balancing speed, accuracy, cost.

A parcel needs six things; classification (the piece I already built an eval for)
is only step 1:

| # | Step | Question | Depth here |
|---|------|----------|------------|
| 1 | Classification | What HS code? | **Deep** — real Anthropic, reuses the 248-item dataset + v2 prompt |
| 2 | Origin verification | Where from? (duty rate, FTA) | Thin |
| 3 | Duty calculation | Import duty = f(HS, origin, dest, value) | Thin — static rate table |
| 4 | Tax assessment | VAT/GST at destination | Thin |
| 5 | Compliance checks | Restricted / prohibited / denied party / de-minimis | Thin — small reference lists |
| 6 | Declaration | Final filing data | Thin |

## Who the customers are

SWIP sells to anyone in the cross-border chain: goods flow **merchant → marketplace
→ carrier → broker → customs**. Each pulls the speed/accuracy/cost triangle a
different way, which is why "who is the first customer?" decides the architecture.

| Actor | Who | Gives SWIP | Gets back | Constraint that shapes design |
|---|---|---|---|---|
| **Merchant** | A seller/brand (a Shopify store) | Product catalog: title, description, value, origin | HS code + duty estimate so the parcel clears; landed cost at checkout | Knows the product, **not the customs code**. Low volume, one item at a time. Legally responsible if the declaration is wrong |
| **Marketplace** | Aggregator of many merchants (Amazon, Rakuten, Shopee) | **Millions** of SKUs from thousands of sellers — messy, inconsistent | Classification at scale, to show duty-inclusive (DDP) prices and generate docs | Huge scale + dirty data + **doesn't own product knowledge**. Needs **batch async, high throughput, cheap per SKU** |
| **Carrier** | Ships the parcel across the border (DHL, FedEx, Japan Post); often also files customs | Manifest: contents, declared value, sender/receiver, weight | Validated HS code + duty/tax + compliance flags + a ready-to-file declaration | Parcel is **physically moving** → needs **real-time, fast, reliable**. Usually the one *filing*, so errors = held parcels, fines |
| **Broker** | Customs intermediary filing on others' behalf | Shipment data to declare | A valid declaration less likely to be flagged | Legal expertise; needs accuracy + a defensible audit trail |

**Why this matters for V1:** a marketplace-first product optimizes for the batch
pipeline; a carrier-first product optimizes for low-latency real-time. (This is
exactly Q1 of the written exercise — "one at a time or batch?" — and the answer
depends on the first customer.)

## Input → Output

**Input** (one shipment line, from CSV upload or API):

```jsonc
{ "external_ref": "SKU-991", "raw_title": "Cute Cat Hoodie Soft Warm XL Gift",
  "declared_value": 24.90, "currency": "USD",
  "origin_country": "CN", "destination_country": "JP", "quantity": 1 }
```

**Output:**

```jsonc
{ "hs_code": "6110.30", "hs_confidence": 0.86, "classification_source": "auto",
  "duty_amount": 0.00, "tax_amount": 2.49, "total_landed_cost": 27.39,
  "compliance_flags": [], "status": "cleared", "audit_trail": [ ... ] }
```

### Field glossary

`sku`, `title`, `description` are **three different things**, not one:

| Field | What | Example | Why |
|---|---|---|---|
| `sku` | The merchant's **internal id** for a product *variant* — a code, not a name. **Not a customs requirement**, **not globally unique** (per-merchant namespace) | `TSHIRT-RED-XL` | Reference back to the customer's system + dedup *within one customer* |
| `title` | Short human name (often dirty) | `Cute Cat Hoodie Soft Warm XL Gift` | Primary classifier input |
| `description` | Longer detail | `100% cotton, knitted, women's pullover` | Holds material / knit-vs-woven — often the **deciding fact** |
| `declared_value` | Customs value **per unit**; line total = value × quantity | `40.00` | Duty is charged on this |
| `currency` | Currency of the value | `USD`, `JPY` | Must convert to the destination currency |
| `origin_country` | Country **made in** (not shipped from) | `CN` | Sets the duty rate + FTA eligibility |
| `destination_country` | Country **imported into** | `JP` | Picks the tariff schedule, VAT rate, de-minimis, restricted-goods rules |
| `quantity` | Number of **identical units** of this SKU in the line | `3` | A SKU is a product *type*; quantity is how many physical pieces |
| `material?` | Composition (optional) | `cotton, knit` | Often decisive; **often missing** → when missing & decisive, ask or route to a human |

So: **one shipment line = one SKU × quantity; one parcel = one or more lines.**

Output fields mirror the six pipeline steps: `hs_code`/`hs_confidence`/
`classification_source` (classification + provenance), `duty_amount` (step 3),
`tax_amount` (step 4), `total_landed_cost` (what the buyer ultimately pays —
shown as DDP at checkout), `compliance_flags` (step 5), `status` (the routing
outcome), `audit_trail` (the defensible "why/who/when").

## Flow

Both "classify one item" and "upload a 50k-row batch" go through the **same**
pipeline — the difference is only the ingest adapter. (This answers Q1 of the
written exercise: it's not one-or-the-other, it's one pipeline, two front doors.)

```
  CSV upload ─┐                          ┌─► customer dashboard (status, export)
              ├─ ingest → [ Inngest pipeline, per item ] ─┤
  API call  ─┘   normalize→classify→duty→tax→compliance→  └─► review queue (human
                 risk-score → ROUTER:                          picks 1 of top-3)
                   high conf + low risk → cleared (auto)
                   uncertain / high value → needs_review
                   prohibited / denied   → blocked
```

## Architecture

```
Next.js (Vercel)      UI: upload, dashboard, review queue + API routes (ingest)
Inngest               orchestration: 1 shipment = 1 durable workflow; retries,
                      fan-out, step-level observability
Postgres (Supabase)   shipments · classifications · reviews · audit_log · classification_cache
Anthropic SDK         classifier — reuses prompt v2 / two-stage from the study
```

Every JD phrase maps to a box: *AI orchestration* = Inngest + Anthropic;
*data pipelines* = ingest + batches; *risk scoring on multiple models* = router;
*APIs for high-volume* = ingest API + the cache.

---

## Step 1 — Data model (done)

See [`src/db/schema.ts`](src/db/schema.ts). Five tables, each tied to a decision:

- **`shipments`** is a **state machine** (`status` enum). The dashboard and the
  review queue are just filtered views of this one column. The raw input is kept
  verbatim (real titles are dirty and must be re-processable); the *resolved*
  result is denormalized onto the row for fast queries.

- **`classifications`** is **append-only history**, not a column on the shipment.
  Why: a shipment gets re-classified (model upgrade, human override); keeping
  every attempt gives an audit trail *and* a way to measure model improvement. It
  stores the **full top-3 candidates**, not just the winner — because the product
  thesis is top-3 ≈ 79% vs top-1 ≈ 59%, so the alternatives are load-bearing.

- **`reviews`** is the human-in-the-loop. Every review is also a labelled example
  → the training-data factory that lets automation expand safely over time.

- **`audit_log`** is **append-only, never updated**. A compliance product must
  prove *why* a code was assigned and by whom. A silent overwrite is precisely
  the failure mode we protect against (Q3 of the exercise).

- **`classification_cache`** is the **biggest cost lever at scale**: the same
  product ships thousands of times, so classify once and reuse. **Keyed by a
  content hash, not by SKU and not by a uuid.** SKU is a per-merchant namespace
  (`A:SHIRT-001` ≠ `B:SHIRT-001`) so it would collide; a uuid is random so you
  could never re-derive it from a product. A content hash is *deterministic* — the
  key itself is the lookup. One-way is fine: we recompute it from fresh input, we
  never decode it.

**Interview soundbite:** "I denormalized the current result onto `shipments` for
read speed, but kept `classifications` and `audit_log` as append-only history —
in compliance, you can never lose *why* a decision was made."

## Schema evolution — how old data migrates when features grow

Two kinds of change, handled very differently:

**A. Schema changes (new column/table)** → versioned migrations
(`drizzle-kit generate`, never edited retroactively).

- Additive **nullable** column = backward-compatible, safe.
- **NOT NULL** column = add nullable → backfill old rows (a one-off script, or an
  Inngest job iterating batch-by-batch to avoid locking) → then add the constraint.
- **Rename / drop a live column** = **expand–contract**, never a one-shot:
  `add new → dual-write → backfill → switch reads → drop old`. You *can* remove —
  but only as the **last** step, never the first, while old code/data still
  depends on it. (At early-stage with little data, a short maintenance window +
  `ALTER … RENAME` is the pragmatic call — don't over-engineer expand–contract.)

**B. AI output-shape changes** → usually **don't migrate, re-process.**
Because the raw input is kept verbatim and `classifications`/`audit_log` are
append-only with a `model` + `prompt_version` stamp, a model upgrade or a new step
re-runs the pipeline over old shipments and **appends** a new classification —
old rows stay for before/after comparison, the audit trail is never rewritten.

**jsonb is the escape hatch** for evolving payloads (`candidates`,
`compliance_flags`, `audit.detail`): add fields without a migration. The line we
drew: anything we **query/filter** (status, hs_code, confidence) is a hard column;
anything we only **read alongside** is jsonb.

## Steps 2-4 — Ingest, pipeline, router (done)

- **Ingest** (`src/ingest.ts`) — `ingestBatch` is the single entry both the API
  and CSV upload use: it persists a `batch` + its `shipments`, then fans out one
  `shipment/received` event per item. `createBatchWithShipments` is the same
  persistence without events, used by the CLI demo.

- **The six steps** live as small, pure-ish functions in `src/pipeline/`:
  `normalize` (deterministic, never an LLM) → `classify` (real Anthropic, the v2
  prompt ported from the eval study, `temperature: 0`) → `assess` (duty + tax +
  compliance, deterministic) → `route`.

- **Two orchestrators, same steps.** `src/pipeline/run.ts` is the plain async
  reference the CLI runs. `src/inngest/functions.ts` wraps the *same* steps in
  `step.run` so each is a durable checkpoint: a failed Anthropic call retries that
  step only, a crash resumes from the journal, and `needs_review` pauses the run
  (via `step.waitForEvent`, up to 3 days) until a human emits `review/completed`.
  Comparing the two files shows exactly what Inngest adds and what stays the same.

- **The router** (`src/pipeline/route.ts`) is the product thesis in code: a hard
  compliance flag blocks; otherwise auto-clear above a confidence threshold, with
  a *higher* bar for high-value parcels; below it, route to a human. The
  thresholds are named constants on purpose — they're the knob a non-technical
  founder weighs in on ("how cautious?"), not an implementation detail.

### Next: Step 5 — Human-in-the-loop review queue (Next.js UI + the `review/completed` event).
