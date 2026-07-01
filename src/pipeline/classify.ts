import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Candidate } from "../db/schema.js";

export const MODEL = "claude-sonnet-4-6"; // the eval study's accuracy/cost winner
export const PROMPT_VERSION = "v2";

/** USD per million tokens, from the eval study's model table. */
const PRICE = { inputPerMTok: 3.0, outputPerMTok: 15.0 };

/**
 * v2 system prompt — ported verbatim from the hs-code-classifier study (the
 * reasoning procedure + the misclassification rules found in v1 error analysis),
 * with a JSON output contract bolted on so the pipeline can consume it.
 */
const SYSTEM = `You are a customs tariff classification expert. Given an e-commerce product description, classify it into the Harmonized System (HS 2022) nomenclature and return the 3 most likely 4-digit headings, ordered from most to least likely.

Procedure: first identify (a) what the product IS (function), (b) its material or construction, (c) who/what it is for. Then choose the heading. Classify by the product's essential character, not by accessory features. A specific heading always beats a general one.

Rules that are frequently misapplied:
- Knitted/crocheted garments go in chapter 61; woven (non-knit) garments in chapter 62. 'jersey', 'knit', 'sweatshirt', 'leggings' signal 61; 'denim', 'woven', 'poplin' signal 62.
- T-shirts, singlets and tank tops (knit) are 6109; sweaters, pullovers, sweatshirts and hoodies (knit) are 6110.
- Festive, carnival and Halloween costumes (flimsy, non-durable) are 9505, not 61/62.
- Vacuum-insulated flasks, tumblers and bottles are 9617, not 7323 or 7615.
- Footwear splits by material: rubber/plastic uppers 6402, leather 6403, textile 6404, other 6405.
- Bags, cases, wallets, backpacks and similar containers are 4202 regardless of material.
- Machines with an individual mechanical function are chapter 84; electrical apparatus 85; measuring/medical/optical instruments 90.

Return ONLY a JSON object, no prose, in exactly this shape:
{"candidates":[{"hsCode":"6110","label":"short heading title","reasoning":"one sentence"}],"confidence":0.0}
where "candidates" has the 3 headings best-first and "confidence" (0..1) is your certainty in the FIRST one.`;

const ResponseSchema = z.object({
  candidates: z
    .array(z.object({ hsCode: z.string(), label: z.string().optional(), reasoning: z.string().optional() }))
    .min(1),
  confidence: z.number().min(0).max(1),
});

export interface ClassifyInput {
  rawTitle: string;
  rawDescription?: string | null;
  material?: string | null;
}

export interface ClassifyResult {
  candidates: Candidate[];
  hsCode: string; // the chosen (top) candidate
  confidence: number;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

// Lazy so importing this module never throws when ANTHROPIC_API_KEY is unset
// (e.g. on Vercel, where the live playground passes a per-request key instead).
let envClient: Anthropic | null = null;
function getClient(apiKey?: string): Anthropic {
  if (apiKey) return new Anthropic({ apiKey }); // per-request key from the UI playground
  if (!envClient) envClient = new Anthropic(); // reads env; throws only if actually used without a key
  return envClient;
}

/**
 * Call the model and return the top-3 candidates. `temperature: 0` so the same
 * product classifies the same way run-to-run — important once we cache results.
 *
 * NOTE on confidence: a model's self-reported confidence is a *rough* proxy and
 * is not calibrated. A production router would derive confidence from signal
 * (e.g. two-model agreement, candidate spread) rather than trust this number —
 * that's the "confidence-based routing" follow-up from the study.
 */
export async function classifyWithClaude(
  input: ClassifyInput,
  apiKey?: string,
  // Optional RAG grounding: a retrieved shortlist of likely HS headings. When
  // present, it's added to the prompt so the model picks from real, relevant
  // codes (retrieval handles recall; the model handles precision). Kept as a
  // structural type so this module doesn't depend on the rag layer.
  grounding?: { code: string; title: string }[],
): Promise<ClassifyResult> {
  const product = [input.rawTitle, input.rawDescription, input.material && `Material: ${input.material}`]
    .filter(Boolean)
    .join(". ");

  let userContent = `Product: ${product}`;
  if (grounding?.length) {
    const list = grounding.map((c) => `${c.code} — ${c.title}`).join("\n");
    userContent +=
      `\n\nThe most relevant HS headings for this product, from a vector search over the official heading list (may be imperfect):\n${list}\n\n` +
      `Prefer one of these if it fits the product's essential character; only pick a different heading if none of them are correct.`;
  }

  const started = Date.now();
  const res = await getClient(apiKey).messages.create({
    model: MODEL,
    max_tokens: 1024, // grounding + hard cases produce longer output; 512 truncated
    temperature: 0,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });
  const latencyMs = Date.now() - started;

  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  const cleaned = text.replace(/```json\s*|\s*```/g, "").trim(); // strip markdown fences if any
  const json = cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1);
  let parsed: z.infer<typeof ResponseSchema>;
  try {
    parsed = ResponseSchema.parse(JSON.parse(json));
  } catch {
    // Most often a truncated response (stop_reason "max_tokens") — surface that
    // rather than a cryptic JSON error, so the failure is diagnosable.
    throw new Error(`classifier returned unparseable output (stop_reason=${res.stop_reason}): ${text.slice(0, 160)}…`);
  }

  const inputTokens = res.usage.input_tokens;
  const outputTokens = res.usage.output_tokens;
  return {
    candidates: parsed.candidates,
    hsCode: parsed.candidates[0]!.hsCode,
    confidence: parsed.confidence,
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    inputTokens,
    outputTokens,
    costUsd: (inputTokens * PRICE.inputPerMTok + outputTokens * PRICE.outputPerMTok) / 1_000_000,
    latencyMs,
  };
}
