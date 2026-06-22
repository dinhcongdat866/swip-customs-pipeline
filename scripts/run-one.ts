import "dotenv/config";
import { createBatchWithShipments, type ShipmentInput } from "../src/ingest.js";
import { runPipeline } from "../src/pipeline/run.js";

/**
 * End-to-end smoke test WITHOUT Inngest: ingest a few shipments and run the
 * plain pipeline on each, so you can watch the 6 steps against real Anthropic +
 * Postgres. The durable Inngest path runs the same steps via the dev server.
 *
 *   pnpm db:up && pnpm db:push   # once
 *   pnpm pipeline                # this script
 */
const SAMPLES: ShipmentInput[] = [
  {
    externalRef: "SKU-HOODIE-XL",
    rawTitle: "Cute Cat Hoodie Soft Warm Winter XL Gift",
    rawDescription: "women's knitted pullover hoodie, 100% cotton",
    declaredValue: 24.9, currency: "USD", originCountry: "CN", destinationCountry: "JP", quantity: 1,
  },
  {
    externalRef: "SKU-TUMBLER",
    rawTitle: "Stainless Steel Vacuum Insulated Tumbler 20oz Travel Mug",
    declaredValue: 18, currency: "USD", originCountry: "CN", destinationCountry: "US", quantity: 2,
  },
  {
    externalRef: "SKU-WATCH",
    rawTitle: "Luxury Automatic Mechanical Watch Sapphire Crystal Leather Strap",
    declaredValue: 1450, currency: "USD", originCountry: "CH", destinationCountry: "JP", quantity: 1,
  },
];

const { batchId, shipmentIds } = await createBatchWithShipments({
  customerId: "demo-merchant", source: "api", rows: SAMPLES,
});
console.log(`batch ${batchId} — ${shipmentIds.length} shipments\n`);

for (const id of shipmentIds) {
  const r = await runPipeline(id);
  console.log(
    `→ ${r.status.toUpperCase().padEnd(12)} HS ${r.hsCode}  conf=${r.confidence.toFixed(2)}  ` +
      `duty=$${r.dutyAmount} tax=$${r.taxAmount} landed=$${r.totalLandedCost}  [${r.source}]`,
  );
  if (r.complianceFlags.length) console.log(`   flags: ${r.complianceFlags.map((f) => f.message).join("; ")}`);
  console.log(`   reason: ${r.reason}\n`);
}

process.exit(0);
