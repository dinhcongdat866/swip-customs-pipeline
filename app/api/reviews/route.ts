import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export const dynamic = "force-dynamic";

/**
 * Submitting a review does NOT write the shipment itself — it emits the
 * `review/completed` event. The paused `classifyShipment` run (sitting in
 * `step.waitForEvent`) wakes up and applies the decision + audit. The workflow
 * owns the state transition; the UI just reports that a human acted. That's the
 * whole point of the durable design — and it keeps the audit trail consistent.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { shipmentId, chosenHsCode, pickedFromCandidates, reviewer, note } = body;
  if (!shipmentId || !chosenHsCode) {
    return NextResponse.json({ error: "shipmentId and chosenHsCode are required" }, { status: 400 });
  }
  await inngest.send({
    name: "review/completed",
    data: {
      shipmentId,
      chosenHsCode,
      pickedFromCandidates: pickedFromCandidates ?? "yes",
      reviewer: reviewer ?? "reviewer",
      note,
    },
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
