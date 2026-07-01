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
const MODEL = "Xenova/all-MiniLM-L6-v2";

// Lazy singleton: importing this module doesn't pay the model load; the first
// embed() call warms it once and every later call reuses it.
let extractor: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) extractor = pipeline("feature-extraction", MODEL);
  return extractor;
}

/** Embed one string into a unit-normalized vector (so cosine == dot product). */
export async function embed(text: string): Promise<number[]> {
  const model = await getExtractor();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}
