import { NextResponse } from "next/server";
import { ingestBatch, type ShipmentInput } from "@/ingest";

export const dynamic = "force-dynamic"; // never cache an ingest

/**
 * Front door #1 — the JSON API. Accepts a single shipment object or a `rows`
 * array; both become one batch and fan out `shipment/received` events. Returns
 * 202 Accepted because the work is async (the pipeline runs in Inngest after).
 */
export async function POST(req: Request) {
  const body = await req.json();
  const rows: ShipmentInput[] = Array.isArray(body) ? body : body.rows ?? [body];
  if (!rows.length || rows.some((r) => !r.rawTitle)) {
    return NextResponse.json({ error: "each row needs a rawTitle" }, { status: 400 });
  }
  const customerId = req.headers.get("x-customer-id") ?? "demo-merchant";
  const result = await ingestBatch({ customerId, source: "api", rows });
  return NextResponse.json(result, { status: 202 });
}
