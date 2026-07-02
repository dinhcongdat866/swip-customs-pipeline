import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

/**
 * One-time, offline KB enrichment. For every HS heading, ask a cheap model to
 * (a) split the long multi-item title into self-contained item phrases, and
 * (b) list everyday product words sellers actually use for it.
 *
 * The output (data/enriched-kb.json) is a DERIVED artifact: nobody edits it by
 * hand. When the HS nomenclature updates (~every 5 years), re-run this script
 * on the new headings.json and the KB regenerates — same pipeline, new source.
 *
 *   pnpm kb:enrich      # ~50 batched Haiku calls, roughly $1-2, resumable
 */
// 10 per call: long headings produce many items; 25-per-batch hit the output
// cap (stop_reason max_tokens) on the densest batches.
const BATCH = 10;
const MODEL = "claude-haiku-4-5";

interface Enriched {
  items: string[]; // self-contained item phrases, qualifiers included
  examples: string[]; // everyday seller words
}

const headings: Record<string, string> = JSON.parse(readFileSync("data/headings.json", "utf8"));
const outPath = "data/enriched-kb.json";
const done: Record<string, Enriched> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};

const todo = Object.entries(headings).filter(([code]) => !done[code]);
console.log(`${Object.keys(headings).length} headings, ${todo.length} to enrich`);

const anthropic = new Anthropic();

for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const list = batch.map(([code, title]) => `${code}: ${title}`).join("\n");

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0,
    system:
      "You help build a search index over customs (HS) headings. For each heading, do two things:\n" +
      "1. items: split the title into its individual items as SHORT SELF-CONTAINED phrases. Carry the heading-wide qualifiers (who it's for, material, knitted-or-not) into each phrase.\n" +
      "2. examples: 4-8 everyday product words online sellers would use for goods under this heading (e.g. 'hoodie', 'leggings', 'Halloween costume').\n" +
      'Return ONLY JSON: {"<code>": {"items": [...], "examples": [...]}, ...} for every code given.',
    messages: [{ role: "user", content: list }],
  });

  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(json) as Record<string, Enriched>;
    for (const [code, v] of Object.entries(parsed)) {
      if (headings[code] && Array.isArray(v.items) && Array.isArray(v.examples)) done[code] = v;
    }
  } catch {
    console.warn(`  batch at ${i}: unparseable, will retry on next run (stop_reason=${res.stop_reason})`);
  }
  writeFileSync(outPath, JSON.stringify(done)); // save progress — resumable
  console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length} (total done: ${Object.keys(done).length})`);
}

console.log(`done: ${Object.keys(done).length}/${Object.keys(headings).length} enriched → ${outPath}`);
process.exit(0);
