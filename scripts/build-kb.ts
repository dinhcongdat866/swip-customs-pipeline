import { readFileSync, writeFileSync } from "node:fs";
import { embed } from "../src/rag/embed.js";

/**
 * One-time build of the RAG knowledge base: embed every HS heading's description
 * and store the vectors locally (data/hs-vectors.json). Run once:
 *
 *   pnpm kb:build
 *
 * The vectors are what `retrieveCandidates` searches over. Rebuild only when the
 * heading list or the embedding model changes.
 */
const headings: Record<string, string> = JSON.parse(readFileSync("data/headings.json", "utf8"));
const entries = Object.entries(headings);
console.log(`embedding ${entries.length} HS headings (first run downloads the model)…`);

const kb: { code: string; title: string; vector: number[] }[] = [];
for (let i = 0; i < entries.length; i++) {
  const [code, title] = entries[i]!;
  // Embed the description (the semantic content); the code is just the id.
  kb.push({ code, title, vector: await embed(title) });
  if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${entries.length}`);
}

writeFileSync("data/hs-vectors.json", JSON.stringify(kb));
console.log(`wrote data/hs-vectors.json — ${kb.length} vectors, dim ${kb[0]!.vector.length}`);
process.exit(0);
