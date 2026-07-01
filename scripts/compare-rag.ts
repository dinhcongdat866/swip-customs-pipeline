import "dotenv/config";
import { classifyWithClaude, type ClassifyInput } from "../src/pipeline/classify.js";
import { retrieveCandidates } from "../src/rag/retrieve.js";
import { normalizeTitle } from "../src/pipeline/normalize.js";

/**
 * Compare classification WITHOUT RAG vs WITH RAG grounding, on a few products.
 * Uses real Anthropic calls (costs a few cents) — needs ANTHROPIC_API_KEY.
 *
 *   pnpm kb:build      # once
 *   pnpm rag:compare
 *
 * Read it with the right lens: a strong model already knows common items, so RAG
 * may not change those. Its value shows on the long tail, cheaper models, and
 * guarding against invented codes. `expected` is the heading from CROSS rulings.
 */
const SAMPLES: (ClassifyInput & { expected: string })[] = [
  { rawTitle: "Cute Cat Hoodie Soft Warm Winter XL Gift", rawDescription: "women's knitted pullover hoodie, 100% cotton", expected: "6110" },
  { rawTitle: "Stainless Steel Vacuum Insulated Tumbler 20oz", expected: "9617" }, // material-word pollution case
  { rawTitle: "Women's Activewear Set Leggings High Waist + Crop Top Yoga", material: "nylon/spandex knit", expected: "6104" },
];

for (const s of SAMPLES) {
  console.log(`\n━━ "${s.rawTitle}"  (expected ${s.expected}) ━━`);

  const noRag = await classifyWithClaude(s);
  console.log(`  no-RAG : ${noRag.hsCode}  (conf ${noRag.confidence.toFixed(2)})  ${mark(noRag.hsCode, s.expected)}`);

  // Normalize the dirty title before embedding — strips marketing noise so the
  // query is closer to the customs-language heading descriptions.
  const query = normalizeTitle([s.rawTitle, s.rawDescription, s.material].filter(Boolean).join(" "));
  const grounding = await retrieveCandidates(query, 8);
  const withRag = await classifyWithClaude(s, undefined, grounding);
  console.log(`  RAG    : ${withRag.hsCode}  (conf ${withRag.confidence.toFixed(2)})  ${mark(withRag.hsCode, s.expected)}`);
  console.log(`  shortlist: ${grounding.slice(0, 5).map((c) => c.code).join(", ")}${grounding.some((c) => c.code === s.expected) ? "" : "  ⚠ expected NOT retrieved"}`);
}

function mark(got: string, expected: string): string {
  return got === expected ? "✓" : "✗";
}

process.exit(0);
