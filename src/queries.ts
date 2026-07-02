import { eq, desc, inArray } from "drizzle-orm";
import { db } from "./db/client.js";
import { shipments, classifications, auditLog } from "./db/schema.js";
import type { Candidate } from "./db/schema.js";

export type ShipmentRow = typeof shipments.$inferSelect;

/** Recent shipments for the dashboard, newest first. */
export async function listShipments(limit = 100): Promise<ShipmentRow[]> {
  return db.select().from(shipments).orderBy(desc(shipments.createdAt)).limit(limit);
}

export interface ReviewItem {
  shipment: ShipmentRow;
  candidates: Candidate[]; // top-3 from the latest classification attempt
}

/**
 * The review queue: every `needs_review` and `needs_info` shipment paired with
 * the AI's top-3 candidates (from its most recent classification). needs_info
 * cards additionally show the questions to send the shipper — the reviewer can
 * still resolve them directly once the answers come back.
 */
export async function listReviewQueue(): Promise<ReviewItem[]> {
  const ships = await db
    .select()
    .from(shipments)
    .where(inArray(shipments.status, ["needs_review", "needs_info"]))
    .orderBy(desc(shipments.createdAt));
  if (!ships.length) return [];

  // Latest classification per shipment — fetched newest-first, keep the first seen.
  const rows = await db
    .select()
    .from(classifications)
    .where(inArray(classifications.shipmentId, ships.map((s) => s.id)))
    .orderBy(desc(classifications.createdAt));
  const latest = new Map<string, Candidate[]>();
  for (const r of rows) if (!latest.has(r.shipmentId)) latest.set(r.shipmentId, r.candidates);

  return ships.map((shipment) => ({ shipment, candidates: latest.get(shipment.id) ?? [] }));
}

/** Counts by status, for the dashboard summary. */
export async function statusCounts(rows: ShipmentRow[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

/** A shipment's full audit trail, oldest first — the "why" for one parcel. */
export async function auditTrail(shipmentId: string) {
  return db.select().from(auditLog).where(eq(auditLog.shipmentId, shipmentId)).orderBy(auditLog.createdAt);
}
