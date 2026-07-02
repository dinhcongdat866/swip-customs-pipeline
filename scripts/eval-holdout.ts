import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { classifyWithClaude, PROMPT_VERSION } from "../src/pipeline/classify.js";
import { retrieveCandidates } from "../src/rag/retrieve.js";

/**
 * HELD-OUT eval for prompt-rule changes. The dataset is split deterministically
 * by sorted id: even index = TRAINING half (its misses are what new rules are
 * derived from), odd index = TEST half (never looked at while writing rules).
 *
 * This script runs the CURRENT prompt (RAG arm) on the TEST half only and
 * compares it with the stored v2 results in data/eval-accuracy.json — same
 * products, same retrieval, only the prompt differs. If accuracy doesn't rise
 * on products the rules never saw, the rules memorized noise instead of law.
 *
 * ~124 real API calls (~$1), resumable:  pnpm rag:holdout
 */
interface Row {
  id: string;
  description: string;
  heading: string;
}
interface OldResult {
  rag: string;
  inShortlist: boolean;
}

const data: Row[] = JSON.parse(readFileSync("data/dataset.json", "utf8"));
const v2: Record<string, OldResult> = JSON.parse(readFileSync("data/eval-accuracy.json", "utf8"));

const byId = new Map(data.map((r) => [r.id, r]));
const testIds = [...byId.keys()].sort().filter((_, i) => i % 2 === 1);

const outPath = "data/eval-holdout.json";
const done: Record<string, { got: string; conf: number }> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
const todo = testIds.filter((id) => !done[id]);
console.log(`test half: ${testIds.length} products (prompt ${PROMPT_VERSION}), ${todo.length} to run`);

const CONCURRENCY = 4;
for (let i = 0; i < todo.length; i += CONCURRENCY) {
  const batch = todo.slice(i, i + CONCURRENCY);
  const results = await Promise.all(
    batch.map(async (id) => {
      const row = byId.get(id)!;
      try {
        const grounding = await retrieveCandidates(row.description, 8);
        const r = await classifyWithClaude({ rawTitle: row.description }, undefined, grounding);
        return { id, got: r.hsCode, conf: r.confidence };
      } catch (err) {
        console.warn(`  SKIP ${id}: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    }),
  );
  for (const r of results) if (r) done[r.id] = { got: r.got, conf: r.conf };
  writeFileSync(outPath, JSON.stringify(done)); // resumable
  console.log(`  ${Math.min(i + CONCURRENCY, todo.length)}/${todo.length}`);
}

// ── Compare v2 (stored) vs current prompt on the SAME held-out products ─────
const scored = testIds.filter((id) => done[id]);
const n = scored.length;
const v2Ok = scored.filter((id) => v2[id]!.rag === byId.get(id)!.heading);
const v3Ok = scored.filter((id) => done[id]!.got === byId.get(id)!.heading);
const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`;

console.log(`\nheld-out half, n = ${n} (both arms use RAG)`);
console.log(`  v2 prompt : ${pct(v2Ok.length)}  (${v2Ok.length}/${n})`);
console.log(`  ${PROMPT_VERSION} prompt : ${pct(v3Ok.length)}  (${v3Ok.length}/${n})`);

const fixed = scored.filter((id) => v2[id]!.rag !== byId.get(id)!.heading && done[id]!.got === byId.get(id)!.heading);
const broke = scored.filter((id) => v2[id]!.rag === byId.get(id)!.heading && done[id]!.got !== byId.get(id)!.heading);
console.log(`\n  rules fixed : ${fixed.length}`);
fixed.forEach((id) => console.log(`    ${v2[id]!.rag} → ${byId.get(id)!.heading}  —  ${byId.get(id)!.description}`));
console.log(`  rules broke : ${broke.length}`);
broke.forEach((id) => console.log(`    ${byId.get(id)!.heading} → ${done[id]!.got}  —  ${byId.get(id)!.description}`));
process.exit(0);
