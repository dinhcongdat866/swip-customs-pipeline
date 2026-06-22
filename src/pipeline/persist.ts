import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { shipments, classifications, classificationCache, reviews, auditLog } from "../db/schema.js";
import type { Candidate, ComplianceFlag } from "../db/schema.js";
import type { ClassifyResult } from "./classify.js";
import type { AssessResult } from "./assess.js";
import type { RouteStatus } from "./route.js";

export type Shipment = typeof shipments.$inferSelect;

export async function loadShipment(id: string): Promise<Shipment> {
  const [row] = await db.select().from(shipments).where(eq(shipments.id, id));
  if (!row) throw new Error(`shipment ${id} not found`);
  return row;
}

export async function saveNormalized(id: string, normalizedTitle: string): Promise<void> {
  await db.update(shipments).set({ normalizedTitle, status: "processing", updatedAt: new Date() }).where(eq(shipments.id, id));
}

/** Cache read. On a hit, bump the hit counter so we can measure money saved. */
export async function lookupCache(
  key: string,
): Promise<{ hsCode: string; candidates: Candidate[]; confidence: number | null } | null> {
  const [row] = await db.select().from(classificationCache).where(eq(classificationCache.key, key));
  if (!row) return null;
  await db.update(classificationCache).set({ hits: sql`${classificationCache.hits} + 1` }).where(eq(classificationCache.key, key));
  return { hsCode: row.hsCode, candidates: row.candidates, confidence: row.confidence };
}

/** Append a classification attempt (history) and warm the content cache. */
export async function saveClassification(shipmentId: string, key: string, r: ClassifyResult): Promise<void> {
  await db.insert(classifications).values({
    shipmentId,
    candidates: r.candidates,
    chosenHsCode: r.hsCode,
    confidence: r.confidence,
    model: r.model,
    promptVersion: r.promptVersion,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd.toFixed(6),
    latencyMs: r.latencyMs,
  });
  await db
    .insert(classificationCache)
    .values({
      key,
      hsCode: r.hsCode,
      candidates: r.candidates,
      confidence: r.confidence,
      model: r.model,
      promptVersion: r.promptVersion,
    })
    .onConflictDoNothing();
}

/** Write the resolved result + new status back onto the shipment row. */
export async function applyResolved(
  shipmentId: string,
  v: {
    hsCode: string;
    confidence: number;
    source: "auto" | "cache";
    assess: AssessResult;
    status: RouteStatus;
  },
): Promise<void> {
  await db
    .update(shipments)
    .set({
      hsCode: v.hsCode,
      hsConfidence: v.confidence,
      classificationSource: v.source,
      dutyAmount: v.assess.dutyAmount.toFixed(2),
      taxAmount: v.assess.taxAmount.toFixed(2),
      totalLandedCost: v.assess.totalLandedCost.toFixed(2),
      complianceFlags: v.assess.complianceFlags,
      status: v.status,
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, shipmentId));
}

/** A human reviewer resolved a needs_review shipment. */
export async function applyHumanReview(
  shipmentId: string,
  v: { reviewer: string; chosenHsCode: string; pickedFromCandidates: string; note?: string },
): Promise<void> {
  await db.insert(reviews).values({
    shipmentId,
    reviewer: v.reviewer,
    chosenHsCode: v.chosenHsCode,
    pickedFromCandidates: v.pickedFromCandidates,
    note: v.note,
  });
  await db
    .update(shipments)
    .set({ hsCode: v.chosenHsCode, classificationSource: "human", status: "cleared", updatedAt: new Date() })
    .where(eq(shipments.id, shipmentId));
}

/** Append-only audit entry — emitted by the code that performed the action. */
export async function audit(
  shipmentId: string,
  actor: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLog).values({ shipmentId, actor, action, detail });
}

export type { Candidate, ComplianceFlag };
