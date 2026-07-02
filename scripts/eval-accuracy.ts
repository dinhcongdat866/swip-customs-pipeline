import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { classifyWithClaude } from "../src/pipeline/classify.js";
import { retrieveCandidates } from "../src/rag/retrieve.js";

/**
 * END-TO-END accuracy eval: does RAG grounding actually improve the final
 * classification, not just retrieval recall? Runs all 248 CROSS products
 * through the classifier twice — without and with the retrieved shortlist —
 * and scores the 4-digit heading against the CBP ruling.
 *
 * Beyond the headline numbers, it splits the outcome into the cases that
 * matter: products RAG fixed, products RAG broke, and (for RAG misses)
 * whether the correct code was in the shortlist and ignored, or never
 * retrieved at all. That tells us whether the next fix belongs in the
 * retrieval layer or the model/rules layer.
 *
 * Real Anthropic calls (~$3-4). Progress is saved per product, so a crash
 * or Ctrl+C loses nothing — just run it again:  pnpm rag:eval
 */
interface Row {
  id: string;
  description: string;
  heading: string;
}
interface Result {
  id: string;
  description: string;
  expected: string;
  noRag: string;
  noRagConf: number;
  rag: string;
  ragConf: number;
  inShortlist: boolean;
}

const data: Row[] = JSON.parse(readFileSync("data/dataset.json", "utf8"));
const outPath = "data/eval-accuracy.json";
const done: Record<string, Result> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};

const todo = data.filter((r) => !done[r.id]);
console.log(`${data.length} products, ${todo.length} to run`);

const CONCURRENCY = 4;
for (let i = 0; i < todo.length; i += CONCURRENCY) {
  const batch = todo.slice(i, i + CONCURRENCY);
  const results = await Promise.all(
    batch.map(async (row) => {
      try {
        const input = { rawTitle: row.description };
        // Raw description as the retrieval query — measured better than
        // normalizeTitle (which reorders words and breaks phrase meaning).
        const [noRag, grounding] = await Promise.all([classifyWithClaude(input), retrieveCandidates(row.description, 8)]);
        const rag = await classifyWithClaude(input, undefined, grounding);
        return {
          id: row.id,
          description: row.description,
          expected: row.heading,
          noRag: noRag.hsCode,
          noRagConf: noRag.confidence,
          rag: rag.hsCode,
          ragConf: rag.confidence,
          inShortlist: grounding.some((c) => c.code === row.heading),
        } satisfies Result;
      } catch (err) {
        // One bad response must not kill a 500-call run. Skip it (it stays in
        // `todo` for the next run) and keep going.
        console.warn(`  SKIP ${row.id} "${row.description}": ${err instanceof Error ? err.message : err}`);
        return null;
      }
    }),
  );
  for (const r of results) if (r) done[r.id] = r;
  writeFileSync(outPath, JSON.stringify(done)); // resumable
  console.log(`  ${Math.min(i + CONCURRENCY, todo.length)}/${todo.length}`);
}

// ── Scoring ──────────────────────────────────────────────────────────────
const all = data.map((r) => done[r.id]!).filter(Boolean);
const n = all.length;
const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`;

const noRagOk = all.filter((r) => r.noRag === r.expected);
const ragOk = all.filter((r) => r.rag === r.expected);
console.log(`\nn = ${n}`);
console.log(`  accuracy no-RAG : ${pct(noRagOk.length)}  (${noRagOk.length}/${n})`);
console.log(`  accuracy RAG    : ${pct(ragOk.length)}  (${ragOk.length}/${n})`);

const fixed = all.filter((r) => r.noRag !== r.expected && r.rag === r.expected);
const broke = all.filter((r) => r.noRag === r.expected && r.rag !== r.expected);
console.log(`\n  RAG fixed : ${fixed.length}`);
console.log(`  RAG broke : ${broke.length}`);

// For RAG misses: was the correct code sitting in the shortlist (model's
// fault) or never retrieved (retrieval's fault)?
const ragMiss = all.filter((r) => r.rag !== r.expected);
const ignored = ragMiss.filter((r) => r.inShortlist);
console.log(`\n  RAG misses: ${ragMiss.length} — correct code WAS in shortlist: ${ignored.length}, NOT retrieved: ${ragMiss.length - ignored.length}`);

if (broke.length) {
  console.log(`\nproducts RAG broke:`);
  broke.forEach((r) => console.log(`  ${r.expected} → ${r.rag}  —  ${r.description}`));
}
if (fixed.length) {
  console.log(`\nproducts RAG fixed (first 10):`);
  fixed.slice(0, 10).forEach((r) => console.log(`  ${r.noRag} → ${r.expected}  —  ${r.description}`));
}
process.exit(0);
