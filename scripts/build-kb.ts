import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { embed } from "../src/rag/embed.js";

/**
 * Build the RAG knowledge base vectors. Two modes:
 *
 * - If data/enriched-kb.json exists (from `pnpm kb:enrich`): embed each heading
 *   as MULTIPLE small fragments — one per item phrase, plus one "everyday words"
 *   string, plus the full title. Several vectors all point at the same code, so
 *   a single item ("women's trousers") isn't diluted by its 11 siblings.
 *
 * - Otherwise: fall back to one vector per full title (the original behavior).
 *
 *   pnpm kb:build   →  data/hs-vectors.json
 */
const headings: Record<string, string> = JSON.parse(readFileSync("data/headings.json", "utf8"));

interface Enriched {
  items: string[];
  examples: string[];
}
const enriched: Record<string, Enriched> | null = existsSync("data/enriched-kb.json")
  ? JSON.parse(readFileSync("data/enriched-kb.json", "utf8"))
  : null;

// Assemble the list of (code, text) fragments to embed.
const fragments: { code: string; text: string }[] = [];
for (const [code, title] of Object.entries(headings)) {
  fragments.push({ code, text: title }); // full title always included as a floor
  const e = enriched?.[code];
  if (e) {
    for (const item of e.items) fragments.push({ code, text: item });
    if (e.examples.length) fragments.push({ code, text: e.examples.join(", ") });
  }
}
console.log(
  `embedding ${fragments.length} fragments for ${Object.keys(headings).length} headings` +
    (enriched ? " (enriched)" : " (titles only — run kb:enrich for better recall)"),
);

const kb: { code: string; text: string; vector: number[] }[] = [];
for (let i = 0; i < fragments.length; i++) {
  const f = fragments[i]!;
  kb.push({ code: f.code, text: f.text, vector: await embed(f.text) });
  if ((i + 1) % 250 === 0) console.log(`  ${i + 1}/${fragments.length}`);
}

writeFileSync("data/hs-vectors.json", JSON.stringify(kb));
console.log(`wrote data/hs-vectors.json — ${kb.length} vectors, dim ${kb[0]!.vector.length}`);
process.exit(0);
