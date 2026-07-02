import { normalizeTitle, cacheKey } from "./normalize.js";
import { classifyWithClaude } from "./classify.js";
import { assess, lineValueUsd } from "./assess.js";
import { route } from "./route.js";
import { FX_TO_USD } from "./reference.js";
import {
  loadShipment,
  saveNormalized,
  lookupCache,
  saveClassification,
  applyResolved,
  audit,
  type Shipment,
} from "./persist.js";

/**
 * The pipeline as a plain async function — the readable reference, and what the
 * CLI demo runs. It does NOT pause for human review (it just leaves the shipment
 * in `needs_review`); the durable Inngest version in ../inngest/functions.ts
 * wraps these exact steps and adds retries + waitForEvent. Compare the two to see
 * precisely what Inngest adds and what stays the same.
 */
export async function runPipeline(shipmentId: string) {
  const s = await loadShipment(shipmentId);

  // step 1 — normalize (deterministic) + derive the cache key
  const normalized = normalizeTitle(s.rawTitle);
  const key = cacheKey(normalized, s.destinationCountry);
  await saveNormalized(shipmentId, normalized);

  // step 2 — classify, reusing the cache when the same product was seen before
  const cached = await lookupCache(key);
  let hsCode: string, confidence: number, source: "auto" | "cache";
  let missingInfo: string[] = []; // cache hits were classifiable — no questions
  if (cached) {
    hsCode = cached.hsCode;
    confidence = cached.confidence ?? 0;
    source = "cache";
    await audit(shipmentId, "system:cache", "classified", { hsCode, hit: true });
  } else {
    const result = await classifyWithClaude(s);
    await saveClassification(shipmentId, key, result);
    hsCode = result.hsCode;
    confidence = result.confidence;
    missingInfo = result.missingInfo;
    source = "auto";
    await audit(shipmentId, "system:classifier", "classified", {
      hsCode, confidence, model: result.model, costUsd: result.costUsd, candidates: result.candidates,
    });
  }

  // steps 3-5 — duty, tax, compliance (deterministic)
  const perUnitUsd = Number(s.declaredValue ?? 0) * (FX_TO_USD[s.currency ?? "USD"] ?? 1);
  const assessment = assess({
    hsCode, declaredValueUsd: perUnitUsd, quantity: s.quantity ?? 1, destinationCountry: s.destinationCountry,
  });

  // step 6 — route by confidence + risk
  const lineUsd = lineValueUsd(Number(s.declaredValue ?? 0), s.currency, s.quantity ?? 1);
  const decision = route({ confidence, complianceFlags: assessment.complianceFlags, lineValueUsd: lineUsd, missingInfo });

  await applyResolved(shipmentId, { hsCode, confidence, source, assess: assessment, status: decision.status, missingInfo });
  await audit(shipmentId, "system:router", "routed", { status: decision.status, reason: decision.reason });

  return { shipmentId, status: decision.status, hsCode, confidence, source, ...assessment, reason: decision.reason };
}

export type { Shipment };
