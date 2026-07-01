import { readFileSync } from "node:fs";
import { embed } from "./embed.js";

interface KBEntry {
  code: string;
  title: string;
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

/** Cosine similarity — vectors are unit-normalized, so it's just a dot product. */
function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export interface RetrievedCandidate {
  code: string;
  title: string;
  score: number; // cosine similarity, ~[-1, 1]; higher = more relevant
}

/**
 * The heart of RAG: given a (dirty) product description, return the top-k HS
 * headings whose descriptions are semantically closest. These become the
 * *shortlist* the classifier is grounded on — so the model picks from real,
 * relevant codes instead of recalling all ~1,200 from memory.
 */
export async function retrieveCandidates(productText: string, k = 5): Promise<RetrievedCandidate[]> {
  const query = await embed(productText);
  return loadKB()
    .map((e) => ({ code: e.code, title: e.title, score: cosine(query, e.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
