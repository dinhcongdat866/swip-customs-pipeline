import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Candidate } from "../db/schema.js";
import { AUTO_CLEAR_CONFIDENCE } from "./route.js";

export const MODEL = "claude-sonnet-4-6"; // the eval study's accuracy/cost winner
export const PROMPT_VERSION = "v2.1"; // v2 + the missing-info ("ask, don't guess") contract

/**
 * Second-opinion model for the two-model agreement check. Deliberately a
 * DIFFERENT (and cheaper) model: at temperature 0 the same model would just
 * repeat itself, so independence comes from a different model family.
 */
export const VERIFIER_MODEL = "claude-haiku-4-5";
/** When the two models disagree, confidence is capped here — below every auto-clear threshold. */
export const DISAGREEMENT_CONFIDENCE = 0.6;

/** USD per million tokens, from the eval study's model table. */
const PRICES: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "claude-sonnet-4-6": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  "claude-haiku-4-5": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
};

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

Some descriptions omit the very attribute that DETERMINES the heading — e.g. a garment with no fibre or knit/woven information, a belt or case with no material, a "kit" with no contents. When that happens: still give your best 3 candidates, set confidence LOW (0.5 or less), and put 1-3 short questions for the seller in "missingInfo" — the questions whose answers would decide the heading (e.g. "Knitted or woven?", "What material is it made of?"). If the description is sufficient to classify, "missingInfo" MUST be an empty array.

Return ONLY a JSON object, no prose, in exactly this shape:
{"candidates":[{"hsCode":"6110","label":"short heading title","reasoning":"one sentence"}],"confidence":0.0,"missingInfo":[]}
where "candidates" has the 3 headings best-first and "confidence" (0..1) is your certainty in the FIRST one.`;

const ResponseSchema = z.object({
  candidates: z
    .array(z.object({ hsCode: z.string(), label: z.string().optional(), reasoning: z.string().optional() }))
    .min(1),
  confidence: z.number().min(0).max(1),
  // Questions for the shipper when a heading-determining attribute is absent
  // from the input ("ask, don't guess"). Empty = input was sufficient.
  missingInfo: z.array(z.string()).default([]),
});

export interface ClassifyInput {
  rawTitle: string;
  rawDescription?: string | null;
  material?: string | null;
}

/** Outcome of the two-model agreement check (null = check was skipped as unnecessary). */
export interface Verification {
  model: string;
  hsCode: string; // the verifier's independent top pick
  agreed: boolean; // 4-digit headings match
}

export interface ClassifyResult {
  candidates: Candidate[];
  hsCode: string; // the chosen (top) candidate
  confidence: number;
  missingInfo: string[]; // questions to ask the shipper; empty = input sufficed
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  verification?: Verification | null;
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
  model: string = MODEL,
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
    model,
    max_tokens: 1024, // grounding + hard cases produce longer output; 512 truncated
    temperature: 0,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });
  const latencyMs = Date.now() - started;

  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  const cleaned = text.replace(/```json\s*|\s*```/g, "").trim(); // strip markdown fences if any
  // The model occasionally thinks out loud: a draft JSON, then "wait, let me
  // reconsider" prose, then the corrected JSON. The LAST candidates object is
  // its final answer — parse that one, not a span covering all of them.
  const opens = [...cleaned.matchAll(/\{\s*"candidates"/g)];
  const start = opens.length ? opens[opens.length - 1]!.index : Math.max(cleaned.indexOf("{"), 0);
  const json = cleaned.slice(start, cleaned.lastIndexOf("}") + 1);
  let parsed: z.infer<typeof ResponseSchema>;
  try {
    parsed = ResponseSchema.parse(JSON.parse(json));
  } catch {
    // Most often a truncated response (stop_reason "max_tokens") — surface that
    // rather than a cryptic JSON error, so the failure is diagnosable.
    throw new Error(`classifier returned unparseable output (stop_reason=${res.stop_reason}): ${text.slice(0, 1200)}`);
  }

  const inputTokens = res.usage.input_tokens;
  const outputTokens = res.usage.output_tokens;
  const price = PRICES[model] ?? PRICES[MODEL]!;
  return {
    candidates: parsed.candidates,
    hsCode: parsed.candidates[0]!.hsCode,
    confidence: parsed.confidence,
    missingInfo: parsed.missingInfo,
    model,
    promptVersion: PROMPT_VERSION,
    inputTokens,
    outputTokens,
    costUsd: (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000,
    latencyMs,
  };
}

const heading4 = (code: string) => code.replace(/\D/g, "").slice(0, 4);

/**
 * Two-model agreement check — the "does using two models raise accuracy?"
 * answer, made concrete. The second model does NOT change the answer: the
 * primary's top pick is always what we keep. It changes what we DARE to
 * auto-clear. A model's self-reported confidence is uncalibrated, so before
 * trusting a high number we ask a cheaper model the same question,
 * independently; agreement is evidence the product really is unambiguous,
 * disagreement means "this one is genuinely murky — a human should look".
 *
 * Cost discipline: the verifier only runs when the primary is confident enough
 * to auto-clear (≥ AUTO_CLEAR_CONFIDENCE). Anything already headed for a human
 * or the shipper gains nothing from a second opinion, so we don't pay for one.
 *
 * STATUS: not wired into the pipeline. Measured on the 87 auto-clear cases of
 * the 248-case eval: accuracy 88.5% → 90.2%, 2 real errors caught, 3 false
 * alarms, 8/10 errors slipped through because both models agreed on the same
 * wrong heading (correlated errors — same-family models are not independent).
 * Kept as a reference implementation; the variant worth testing next is a
 * cross-vendor verifier, whose errors should correlate less.
 */
export async function classifyWithSecondOpinion(
  input: ClassifyInput,
  apiKey?: string,
  grounding?: { code: string; title: string }[],
): Promise<ClassifyResult> {
  const primary = await classifyWithClaude(input, apiKey, grounding);
  if (primary.confidence < AUTO_CLEAR_CONFIDENCE) {
    return { ...primary, verification: null }; // already going to a human — skip the check
  }

  const second = await classifyWithClaude(input, apiKey, grounding, VERIFIER_MODEL);
  const agreed = heading4(primary.hsCode) === heading4(second.hsCode);
  return {
    ...primary,
    confidence: agreed ? primary.confidence : Math.min(primary.confidence, DISAGREEMENT_CONFIDENCE),
    inputTokens: primary.inputTokens + second.inputTokens,
    outputTokens: primary.outputTokens + second.outputTokens,
    costUsd: primary.costUsd + second.costUsd,
    latencyMs: primary.latencyMs + second.latencyMs,
    verification: { model: second.model, hsCode: second.hsCode, agreed },
  };
}
