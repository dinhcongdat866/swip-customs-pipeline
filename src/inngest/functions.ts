import { inngest } from "./client.js";
import { normalizeTitle, cacheKey } from "../pipeline/normalize.js";
import { classifyWithClaude } from "../pipeline/classify.js";
import { assess, lineValueUsd } from "../pipeline/assess.js";
import { route } from "../pipeline/route.js";
import { FX_TO_USD } from "../pipeline/reference.js";
import {
  loadShipment, saveNormalized, lookupCache, saveClassification, applyResolved, applyHumanReview, audit,
} from "../pipeline/persist.js";

/**
 * The durable version of runPipeline. Same steps, same logic — but each is a
 * `step.run` checkpoint, so:
 *  - a failed classify (Anthropic timeout) retries that step only, not the whole
 *    pipeline (we never re-pay for a normalize that already succeeded);
 *  - if the process dies mid-run, Inngest replays completed steps from its
 *    journal and resumes where it left off;
 *  - `needs_review` PAUSES the run (no process held) until a human emits
 *    `review/completed`, then resumes — the human-in-the-loop, for free.
 */
export const classifyShipment = inngest.createFunction(
  { id: "classify-shipment", retries: 4, concurrency: { limit: 20 } },
  { event: "shipment/received" },
  async ({ event, step }) => {
    const { shipmentId } = event.data;
    const s = await step.run("load", () => loadShipment(shipmentId));

    // step 1 — normalize (pure, so it can live outside step.run; the write is the step)
    const normalized = normalizeTitle(s.rawTitle);
    const key = cacheKey(normalized, s.destinationCountry);
    await step.run("normalize", () => saveNormalized(shipmentId, normalized));

    // step 2 — cache or classify
    const cached = await step.run("cache-lookup", () => lookupCache(key));
    let hsCode: string, confidence: number, source: "auto" | "cache";
    let missingInfo: string[] = []; // cache hits were classifiable — no questions
    if (cached) {
      hsCode = cached.hsCode;
      confidence = cached.confidence ?? 0;
      source = "cache";
      await step.run("audit-cache", () => audit(shipmentId, "system:cache", "classified", { hsCode, hit: true }));
    } else {
      // The only step that can fail/timeout — Inngest retries just this one.
      const result = await step.run("classify", () => classifyWithClaude(s));
      await step.run("save-classification", () => saveClassification(shipmentId, key, result));
      hsCode = result.hsCode;
      confidence = result.confidence;
      missingInfo = result.missingInfo;
      source = "auto";
      await step.run("audit-classify", () =>
        audit(shipmentId, "system:classifier", "classified", { hsCode, confidence, model: result.model, costUsd: result.costUsd }),
      );
    }

    // steps 3-6 — assess (pure) then route (pure)
    const perUnitUsd = Number(s.declaredValue ?? 0) * (FX_TO_USD[s.currency ?? "USD"] ?? 1);
    const assessment = assess({ hsCode, declaredValueUsd: perUnitUsd, quantity: s.quantity ?? 1, destinationCountry: s.destinationCountry });
    const lineUsd = lineValueUsd(Number(s.declaredValue ?? 0), s.currency, s.quantity ?? 1);
    const decision = route({ confidence, complianceFlags: assessment.complianceFlags, lineValueUsd: lineUsd, missingInfo });

    await step.run("apply", () => applyResolved(shipmentId, { hsCode, confidence, source, assess: assessment, status: decision.status, missingInfo }));
    await step.run("audit-route", () => audit(shipmentId, "system:router", "routed", { status: decision.status, reason: decision.reason }));

    // ★ human-in-the-loop: pause here for up to 3 days until a reviewer acts.
    // `needs_info` pauses the same way — in production the wake-up event would
    // carry the shipper's answers; in the prototype a reviewer resolves both.
    if (decision.status === "needs_review" || decision.status === "needs_info") {
      const review = await step.waitForEvent("await-review", {
        event: "review/completed",
        match: "data.shipmentId",
        timeout: "3d",
      });
      if (!review) {
        await step.run("audit-review-timeout", () => audit(shipmentId, "system", "review_timeout", {}));
        return { shipmentId, status: decision.status, resolved: false };
      }
      await step.run("apply-review", () => applyHumanReview(shipmentId, review.data));
      await step.run("audit-reviewed", () => audit(shipmentId, `user:${review.data.reviewer}`, "reviewed", { chosenHsCode: review.data.chosenHsCode }));
    }

    await step.run("finalize", () => audit(shipmentId, "system", "finalized", { status: decision.status }));
    return { shipmentId, status: decision.status, hsCode };
  },
);

export const functions = [classifyShipment];
