import "dotenv/config";
import { createBatchWithShipments, type ShipmentInput } from "../src/ingest.js";
import { normalizeTitle, cacheKey } from "../src/pipeline/normalize.js";
import { assess, lineValueUsd } from "../src/pipeline/assess.js";
import { route } from "../src/pipeline/route.js";
import { FX_TO_USD } from "../src/pipeline/reference.js";
import { loadShipment, saveNormalized, saveClassification, applyResolved, audit } from "../src/pipeline/persist.js";
import type { Candidate } from "../src/db/schema.js";
import type { ClassifyResult } from "../src/pipeline/classify.js";

/**
 * Populate a deployed (or local) DB with realistic demo data WITHOUT calling
 * Anthropic — so the dashboard and review queue look rich the instant someone
 * opens the link. Classifications are fixed but the duty/tax/compliance/routing
 * are computed by the real pipeline functions, so the numbers stay consistent.
 *
 *   DATABASE_URL=<supabase> pnpm db:push
 *   DATABASE_URL=<supabase> pnpm seed:demo
 */
interface Sample {
  input: ShipmentInput;
  candidates: Candidate[];
  confidence: number;
}

const SAMPLES: Sample[] = [
  {
    input: { externalRef: "SKU-HOODIE-XL", rawTitle: "Cute Cat Hoodie Soft Warm Winter XL Gift",
      rawDescription: "women's knitted pullover hoodie, 100% cotton", declaredValue: 120, currency: "USD",
      originCountry: "CN", destinationCountry: "JP", quantity: 1, material: "cotton, knit" },
    candidates: [
      { hsCode: "6110", label: "Sweaters, pullovers, sweatshirts (knit)", reasoning: "Knitted pullover hoodie", score: 0.91 },
      { hsCode: "6109", label: "T-shirts, singlets (knit)" },
      { hsCode: "6205", label: "Men's shirts (woven)" },
    ],
    confidence: 0.91, // → cleared
  },
  {
    input: { externalRef: "SKU-TUMBLER", rawTitle: "Stainless Steel Vacuum Insulated Tumbler 20oz Travel Mug",
      declaredValue: 18, currency: "USD", originCountry: "CN", destinationCountry: "US", quantity: 2 },
    candidates: [
      { hsCode: "9617", label: "Vacuum flasks and vessels", reasoning: "Vacuum-insulated vessel", score: 0.88 },
      { hsCode: "7323", label: "Table/kitchen articles of iron or steel" },
      { hsCode: "7615", label: "Table/kitchen articles of aluminium" },
    ],
    confidence: 0.88, // → cleared (US de-minimis)
  },
  {
    input: { externalRef: "SKU-WATCH", rawTitle: "Luxury Automatic Mechanical Watch Sapphire Crystal Leather Strap",
      declaredValue: 1450, currency: "USD", originCountry: "CH", destinationCountry: "JP", quantity: 1 },
    candidates: [
      { hsCode: "9102", label: "Wrist-watches (non-precious metal)", reasoning: "Mechanical wristwatch", score: 0.74 },
      { hsCode: "9101", label: "Wrist-watches with precious-metal case" },
      { hsCode: "9114", label: "Other clock/watch parts" },
    ],
    confidence: 0.74, // high value → needs_review
  },
  {
    input: { externalRef: "SKU-AMMO", rawTitle: "Hunting Rifle Ammunition Cartridges Box of 50",
      declaredValue: 40, currency: "USD", originCountry: "US", destinationCountry: "JP", quantity: 1 },
    candidates: [
      { hsCode: "9306", label: "Bombs, ammunition and parts", reasoning: "Firearm ammunition", score: 0.8 },
      { hsCode: "9305", label: "Parts/accessories of arms" },
      { hsCode: "3601", label: "Propellant powders" },
    ],
    confidence: 0.8, // chapter 93 → blocked regardless of confidence
  },
  {
    input: { externalRef: "SKU-ACTIVE", rawTitle: "Women's Activewear Set Leggings High Waist + Crop Top Yoga",
      declaredValue: 95, currency: "USD", originCountry: "VN", destinationCountry: "JP", quantity: 1, material: "nylon/spandex knit" },
    candidates: [
      { hsCode: "6104", label: "Women's suits/ensembles (knit)", reasoning: "Knit ensemble", score: 0.68 },
      { hsCode: "6108", label: "Women's slips, briefs (knit)" },
      { hsCode: "6212", label: "Brassieres, girdles and similar" },
    ],
    confidence: 0.68, // → needs_review
  },
  {
    input: { externalRef: "SKU-EARBUDS", rawTitle: "Wireless Bluetooth Earbuds Noise Cancelling with Charging Case",
      declaredValue: 29, currency: "USD", originCountry: "CN", destinationCountry: "US", quantity: 1 },
    candidates: [
      { hsCode: "8518", label: "Headphones, earphones, speakers", reasoning: "Earphones", score: 0.9 },
      { hsCode: "8517", label: "Telephone/communication apparatus" },
      { hsCode: "8543", label: "Other electrical machines" },
    ],
    confidence: 0.9, // → cleared
  },
];

const { batchId, shipmentIds } = await createBatchWithShipments({
  customerId: "demo-merchant", source: "api", rows: SAMPLES.map((s) => s.input),
});
console.log(`seeded batch ${batchId} — ${shipmentIds.length} shipments`);

for (let i = 0; i < shipmentIds.length; i++) {
  const id = shipmentIds[i]!;
  const { candidates, confidence } = SAMPLES[i]!;
  const hsCode = candidates[0]!.hsCode;
  const s = await loadShipment(id);

  const normalized = normalizeTitle(s.rawTitle);
  await saveNormalized(id, normalized);

  const r: ClassifyResult = {
    candidates, hsCode, confidence, model: "claude-sonnet-4-6", promptVersion: "v2",
    inputTokens: 1180, outputTokens: 90, costUsd: 0.0048, latencyMs: 8600,
  };
  await saveClassification(id, cacheKey(normalized, s.destinationCountry), r);
  await audit(id, "system:classifier", "classified", { hsCode, confidence, model: r.model });

  const perUnitUsd = Number(s.declaredValue ?? 0) * (FX_TO_USD[s.currency ?? "USD"] ?? 1);
  const assessment = assess({ hsCode, declaredValueUsd: perUnitUsd, quantity: s.quantity ?? 1, destinationCountry: s.destinationCountry });
  const lineUsd = lineValueUsd(Number(s.declaredValue ?? 0), s.currency, s.quantity ?? 1);
  const decision = route({ confidence, complianceFlags: assessment.complianceFlags, lineValueUsd: lineUsd });

  await applyResolved(id, { hsCode, confidence, source: "auto", assess: assessment, status: decision.status });
  await audit(id, "system:router", "routed", { status: decision.status, reason: decision.reason });
  console.log(`  ${decision.status.padEnd(12)} ${hsCode}  ${s.rawTitle.slice(0, 40)}`);
}

process.exit(0);
