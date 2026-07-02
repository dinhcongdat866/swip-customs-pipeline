import { readFileSync } from "node:fs";
import { embedQuery } from "./embed.js";

interface KBEntry {
  code: string;
  text: string; // the fragment that was embedded (an item phrase, examples, or the full title)
  vector: number[];
}

// Load the pre-built vectors once (local file for the prototype; this is the
// piece that becomes a pgvector query at enterprise scale — same idea, the
// storage swaps, the retrieval logic doesn't).
let kb: KBEntry[] | null = null;
function loadKB(): KBEntry[] {
  if (!kb) kb = JSON.parse(readFileSync("data/hs-vectors.json", "utf8")) as KBEntry[];
  return kb;
}

// The official heading titles, for display: matching happens on fragments, but
// the classifier prompt should show the real (legal) heading text.
let titles: Record<string, string> | null = null;
function loadTitles(): Record<string, string> {
  if (!titles) titles = JSON.parse(readFileSync("data/headings.json", "utf8")) as Record<string, string>;
  return titles;
}

/** Cosine similarity — vectors are unit-normalized, so it's just a dot product. */
function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export interface RetrievedCandidate {
  code: string;
  title: string; // official heading title
  score: number; // best fragment's cosine similarity for this code
  matched: string; // which fragment matched — useful for debugging retrieval
}

/**
 * Given a (dirty) product description, return the top-k HS headings whose
 * fragments are semantically closest. A heading is represented by MANY small
 * fragments (item phrases, everyday words, full title); we score every fragment
 * and keep each code's best hit, so one code can't flood the list and a single
 * item isn't drowned out by its siblings in a long title.
 */
export async function retrieveCandidates(productText: string, k = 5): Promise<RetrievedCandidate[]> {
  const query = await embedQuery(productText);

  // Best-scoring fragment per code.
  const best = new Map<string, { score: number; matched: string }>();
  for (const e of loadKB()) {
    const score = cosine(query, e.vector);
    const cur = best.get(e.code);
    if (!cur || score > cur.score) best.set(e.code, { score, matched: e.text });
  }

  const titleOf = loadTitles();
  return [...best.entries()]
    .map(([code, v]) => ({ code, title: titleOf[code] ?? v.matched, score: v.score, matched: v.matched }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
