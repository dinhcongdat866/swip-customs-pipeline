import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

/**
 * Local, self-hosted sentence embeddings via transformers.js — no API key, no
 * cost, and (the enterprise-critical part) **no data leaves the machine**. The
 * model (all-MiniLM-L6-v2) downloads once on first use, then runs on CPU.
 *
 * For a production/enterprise build the *approach* is unchanged — you'd swap in a
 * stronger self-hosted model (bge/e5/gte-large or a domain fine-tune) and move
 * the vectors into pgvector; the data-stays-local property holds either way.
 */
// Upgraded from all-MiniLM-L6-v2 after measuring recall@20 = ~59% on the 248
// CROSS products — the misses showed MiniLM failing to bridge product words to
// customs-heading language even with literal overlap ("hooded pullover" missed
// "Jerseys, pullovers..."). bge-small is the same size class, still local, but
// trained specifically for retrieval.
const MODEL = "Xenova/bge-small-en-v1.5";

// bge-v1.5 is asymmetric: short QUERIES need this instruction prefix; the
// documents (HS headings) are embedded without it.
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

// Lazy singleton: importing this module doesn't pay the model load; the first
// embed() call warms it once and every later call reuses it.
let extractor: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) extractor = pipeline("feature-extraction", MODEL);
  return extractor;
}

/** Embed a DOCUMENT (e.g. an HS heading description) into a unit vector. */
export async function embed(text: string): Promise<number[]> {
  const model = await getExtractor();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/** Embed a QUERY (a product description) — bge wants the instruction prefix here. */
export async function embedQuery(text: string): Promise<number[]> {
  return embed(QUERY_PREFIX + text);
}
