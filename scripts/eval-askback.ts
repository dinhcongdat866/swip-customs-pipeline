import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { classifyWithClaude, PROMPT_VERSION } from "../src/pipeline/classify.js";
import { retrieveCandidates } from "../src/rag/retrieve.js";

/**
 * Validate the "ask, don't guess" contract BEFORE plumbing it into the
 * pipeline. Runs the RAG arm on all 248 CROSS products with the v2.1 prompt
 * (which may return missingInfo questions) and answers two questions:
 *
 *  1. Regression: did overall accuracy move vs the stored v2 run
 *     (data/eval-accuracy.json)? The contract change must not cost accuracy.
 *  2. Signal quality: is the flag REAL? If flagged ("I'm missing info")
 *     products score much lower than unflagged ones, the flag is a valid
 *     routing signal — flagged shipments genuinely need a human/shipper.
 *     If flagged ≈ unflagged, the model is just decorating and we stop here.
 *
 * ~248 calls (~$1.5), resumable:  pnpm rag:askback
 */
interface Row {
  id: string;
  description: string;
  heading: string;
}
interface Result {
  got: string;
  conf: number;
  missing: string[];
}

const data: Row[] = JSON.parse(readFileSync("data/dataset.json", "utf8"));
const v2: Record<string, { rag: string }> = JSON.parse(readFileSync("data/eval-accuracy.json", "utf8"));

const outPath = "data/eval-askback.json";
const done: Record<string, Result> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
const todo = data.filter((r) => !done[r.id]);
console.log(`${data.length} products (prompt ${PROMPT_VERSION}), ${todo.length} to run`);

const CONCURRENCY = 4;
for (let i = 0; i < todo.length; i += CONCURRENCY) {
  const batch = todo.slice(i, i + CONCURRENCY);
  const results = await Promise.all(
    batch.map(async (row) => {
      try {
        const grounding = await retrieveCandidates(row.description, 8);
        const r = await classifyWithClaude({ rawTitle: row.description }, undefined, grounding);
        return { id: row.id, got: r.hsCode, conf: r.confidence, missing: r.missingInfo };
      } catch (err) {
        console.warn(`  SKIP ${row.id}: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    }),
  );
  for (const r of results) if (r) done[r.id] = { got: r.got, conf: r.conf, missing: r.missing };
  writeFileSync(outPath, JSON.stringify(done)); // resumable
  console.log(`  ${Math.min(i + CONCURRENCY, todo.length)}/${todo.length}`);
}

// ── 1. Regression vs stored v2 ───────────────────────────────────────────────
const scored = data.filter((r) => done[r.id]);
const n = scored.length;
const pct = (num: number, den: number) => `${((num / den) * 100).toFixed(1)}%`;
const v2Ok = scored.filter((r) => v2[r.id]?.rag === r.heading).length;
const v21Ok = scored.filter((r) => done[r.id]!.got === r.heading).length;
console.log(`\nn = ${n} (RAG arm)`);
console.log(`  accuracy v2   : ${pct(v2Ok, n)}  (${v2Ok}/${n})`);
console.log(`  accuracy ${PROMPT_VERSION} : ${pct(v21Ok, n)}  (${v21Ok}/${n})`);

// ── 2. Is the flag informative? ──────────────────────────────────────────────
const flagged = scored.filter((r) => done[r.id]!.missing.length > 0);
const clean = scored.filter((r) => done[r.id]!.missing.length === 0);
const okOf = (rows: Row[]) => rows.filter((r) => done[r.id]!.got === r.heading).length;
console.log(`\n  flagged "missing info": ${flagged.length}/${n} (${pct(flagged.length, n)})`);
console.log(`    accuracy when flagged   : ${pct(okOf(flagged), flagged.length)}  (${okOf(flagged)}/${flagged.length})`);
console.log(`    accuracy when NOT flagged: ${pct(okOf(clean), clean.length)}  (${okOf(clean)}/${clean.length})`);

console.log(`\nsample flagged products (question the model wants answered):`);
flagged.slice(0, 12).forEach((r) => {
  const d = done[r.id]!;
  const mark = d.got === r.heading ? "✓" : "✗";
  console.log(`  ${mark} "${r.description}" → ${d.got} (conf ${d.conf.toFixed(2)}) — asks: ${d.missing.join(" / ")}`);
});
process.exit(0);
