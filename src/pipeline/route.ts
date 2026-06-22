import type { ComplianceFlag } from "../db/schema.js";

/**
 * The confidence router — the heart of the product thesis. It decides whether a
 * shipment can clear automatically or must go to a human, balancing speed/cost
 * (auto) against the risk of a silent wrong classification (review/block).
 *
 * Thresholds are deliberately explicit and named: these are exactly the knobs a
 * non-technical founder weighs in on ("how cautious do we want to be?"), not an
 * implementation detail.
 */
export const AUTO_CLEAR_CONFIDENCE = 0.85; // clear without a human above this
export const HIGH_VALUE_USD = 1000; // expensive parcels demand more certainty
export const HIGH_VALUE_CONFIDENCE = 0.95; // ...this much, before auto-clearing

export type RouteStatus = "cleared" | "needs_review" | "blocked";

export interface RouteInput {
  confidence: number;
  complianceFlags: ComplianceFlag[];
  lineValueUsd: number;
}

export interface RouteDecision {
  status: RouteStatus;
  reason: string;
}

export function route(input: RouteInput): RouteDecision {
  // 1. A hard compliance block always wins — never auto-clear prohibited goods.
  const blocker = input.complianceFlags.find((f) => f.severity === "block");
  if (blocker) return { status: "blocked", reason: blocker.message };

  // 2. Higher value ⇒ we require higher confidence before trusting automation.
  const needed = input.lineValueUsd >= HIGH_VALUE_USD ? HIGH_VALUE_CONFIDENCE : AUTO_CLEAR_CONFIDENCE;

  if (input.confidence >= needed) {
    return { status: "cleared", reason: `confidence ${input.confidence} ≥ ${needed}` };
  }
  return {
    status: "needs_review",
    reason: `confidence ${input.confidence} < ${needed}${
      input.lineValueUsd >= HIGH_VALUE_USD ? " (high-value)" : ""
    }`,
  };
}
