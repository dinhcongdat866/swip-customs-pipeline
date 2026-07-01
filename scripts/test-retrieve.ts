import { retrieveCandidates } from "../src/rag/retrieve.js";

/**
 * Smoke test for retrieval BEFORE wiring it into the classifier: do the right HS
 * headings surface for a few dirty product titles?
 *
 *   pnpm kb:build     # once, to create data/hs-vectors.json
 *   pnpm rag:test
 *
 * Expected top hits: hoodie → 6110 (knit pullovers), tumbler → 9617 (vacuum
 * vessels), earbuds → 8518 (headphones/earphones).
 */
const SAMPLES = [
  "Cute Cat Hoodie Soft Warm Winter XL Gift", // knit pullover → 6110
  "Stainless Steel Vacuum Insulated Tumbler 20oz", // vacuum vessel → 9617
  "Wireless Bluetooth Earbuds Noise Cancelling", // earphones → 8518
];

for (const s of SAMPLES) {
  const candidates = await retrieveCandidates(s, 5);
  console.log(`\n"${s}"`);
  for (const c of candidates) console.log(`  ${c.code}  ${c.score.toFixed(3)}  ${c.title}`);
}
process.exit(0);
