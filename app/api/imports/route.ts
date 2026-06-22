import { NextResponse } from "next/server";
import { ingestBatch, parseCsv } from "@/ingest";

export const dynamic = "force-dynamic";

/**
 * Front door #2 — CSV upload. Same destination as the JSON API (one pipeline),
 * the only difference is the adapter: parse the CSV into rows, then ingest with
 * source "csv". Accepts the raw CSV as the request body (text/csv).
 */
export async function POST(req: Request) {
  const text = await req.text();
  const rows = parseCsv(text);
  if (!rows.length) return NextResponse.json({ error: "no rows parsed from CSV" }, { status: 400 });
  const customerId = req.headers.get("x-customer-id") ?? "demo-merchant";
  const result = await ingestBatch({ customerId, source: "csv", rows });
  return NextResponse.json(result, { status: 202 });
}
