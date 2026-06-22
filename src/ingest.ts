import { db } from "./db/client.js";
import { batches, shipments } from "./db/schema.js";
import { inngest } from "./inngest/client.js";

/** What a caller (API body row or a parsed CSV line) provides per shipment. */
export interface ShipmentInput {
  externalRef?: string;
  rawTitle: string;
  rawDescription?: string;
  declaredValue?: number;
  currency?: string;
  originCountry?: string;
  destinationCountry?: string;
  quantity?: number;
  material?: string;
}

/**
 * Persist a batch + its shipments. No events — pure DB. The CLI demo uses this
 * and then drives the pipeline directly; the production entry (`ingestBatch`)
 * wraps it and emits events instead.
 */
export async function createBatchWithShipments(opts: {
  customerId: string;
  source: "csv" | "api";
  rows: ShipmentInput[];
}): Promise<{ batchId: string; shipmentIds: string[] }> {
  const [batch] = await db
    .insert(batches)
    .values({ source: opts.source, customerId: opts.customerId, itemCount: opts.rows.length })
    .returning();

  const inserted = await db
    .insert(shipments)
    .values(
      opts.rows.map((r) => ({
        batchId: batch!.id,
        externalRef: r.externalRef,
        rawTitle: r.rawTitle,
        rawDescription: r.rawDescription,
        declaredValue: r.declaredValue != null ? r.declaredValue.toFixed(2) : null,
        currency: r.currency,
        originCountry: r.originCountry,
        destinationCountry: r.destinationCountry,
        quantity: r.quantity ?? 1,
        material: r.material,
      })),
    )
    .returning({ id: shipments.id });

  return { batchId: batch!.id, shipmentIds: inserted.map((x) => x.id) };
}

/**
 * Production entry — **one pipeline, two front doors**. A single API call or a
 * CSV upload both land here, persist, and fan out one `shipment/received` event
 * per item. Inngest then runs the durable workflow per shipment, concurrently.
 */
export async function ingestBatch(opts: {
  customerId: string;
  source: "csv" | "api";
  rows: ShipmentInput[];
}): Promise<{ batchId: string; shipmentIds: string[] }> {
  const { batchId, shipmentIds } = await createBatchWithShipments(opts);
  await inngest.send([
    { name: "batch/created", data: { batchId, shipmentIds } },
    ...shipmentIds.map((shipmentId) => ({ name: "shipment/received" as const, data: { shipmentId } })),
  ]);
  return { batchId, shipmentIds };
}

/** Minimal CSV adapter: header row + comma-separated values → ShipmentInput[]. */
export function parseCsv(text: string): ShipmentInput[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = header!.split(",").map((c) => c.trim());
  return lines.map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    cols.forEach((c, i) => (row[c] = cells[i]?.trim() ?? ""));
    return {
      externalRef: row.sku || undefined,
      rawTitle: row.title ?? "",
      rawDescription: row.description || undefined,
      declaredValue: row.declared_value ? Number(row.declared_value) : undefined,
      currency: row.currency || undefined,
      originCountry: row.origin_country || undefined,
      destinationCountry: row.destination_country || undefined,
      quantity: row.quantity ? Number(row.quantity) : undefined,
      material: row.material || undefined,
    };
  });
}
