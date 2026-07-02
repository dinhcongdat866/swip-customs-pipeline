import { readFileSync } from "node:fs";
import { retrieveCandidates } from "../src/rag/retrieve.js";
import { normalizeTitle } from "../src/pipeline/normalize.js";

/**
 * Measure retrieval RECALL@k on the 248 CROSS products: for each product, does
 * the correct HS heading appear in the retrieved top-k? This is the ceiling on
 * how much RAG can help — the model can only pick a code that was retrieved.
 *
 * Local + free (embeddings + cosine, no LLM calls):  pnpm rag:recall
 */
interface Row {
  description: string;
  heading: string;
}
const data: Row[] = JSON.parse(readFileSync("data/dataset.json", "utf8"));

const KS = [5, 10, 20];
const maxK = Math.max(...KS);
const hits: Record<number, number> = Object.fromEntries(KS.map((k) => [k, 0]));
const misses: Row[] = [];

console.log(`measuring recall@k over ${data.length} products…`);
for (let i = 0; i < data.length; i++) {
  const row = data[i]!;
  const candidates = await retrieveCandidates(normalizeTitle(row.description), maxK);
  const rank = candidates.findIndex((c) => c.code === row.heading); // 0-based; -1 = not found
  for (const k of KS) if (rank >= 0 && rank < k) hits[k]!++;
  if (rank < 0) misses.push(row);
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${data.length}`);
}

console.log(`\nn = ${data.length}`);
for (const k of KS) console.log(`  recall@${k.toString().padStart(2)}: ${((hits[k]! / data.length) * 100).toFixed(1)}%`);
console.log(`\nnot retrieved in top-${maxK}: ${misses.length}`);
misses.slice(0, 12).forEach((m) => console.log(`  expected ${m.heading}  —  ${m.description}`));
process.exit(0);
