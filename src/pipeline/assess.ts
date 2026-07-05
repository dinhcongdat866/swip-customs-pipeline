import type { ComplianceFlag } from "../db/schema.js";
import { DUTY_RATES, VAT_RATES, DE_MINIMIS_USD, RESTRICTED_CHAPTERS, FX_TO_USD } from "./reference.js";

export interface AssessInput {
  hsCode: string;
  declaredValueUsd: number; // per unit, already converted to USD
  quantity: number;
  destinationCountry: string | null;
  /**
   * Live rate from the synced tariff_rules table (see tariff-rules.ts), already
   * resolved by the caller. Only supplied when the lookup was unambiguous;
   * null/undefined falls back to the static reference map below.
   */
  liveDutyRate?: number | null;
}

export interface AssessResult {
  dutyAmount: number;
  taxAmount: number;
  totalLandedCost: number;
  complianceFlags: ComplianceFlag[];
}

/** Convert a per-unit value in any currency to a USD line total. */
export function lineValueUsd(declaredValue: number, currency: string | null, quantity: number): number {
  const fx = FX_TO_USD[currency ?? "USD"] ?? 1;
  return declaredValue * fx * quantity;
}

/**
 * Steps 3-5 in one deterministic pass: duty, tax, and compliance. Deterministic
 * on purpose — given the same HS code and route, the money and the flags must be
 * reproducible and auditable (no LLM here).
 */
export function assess(input: AssessInput): AssessResult {
  const dest = input.destinationCountry ?? "";
  const chapter = input.hsCode.slice(0, 2);
  const lineValue = input.declaredValueUsd * input.quantity;
  const flags: ComplianceFlag[] = [];

  // --- step 5: compliance — restricted/prohibited by chapter ---
  const restricted = RESTRICTED_CHAPTERS[chapter];
  if (restricted) flags.push(restricted);

  // --- de-minimis: below threshold, duty/tax are waived ---
  const threshold = DE_MINIMIS_USD[dest];
  const underDeMinimis = threshold !== undefined && lineValue < threshold;
  if (underDeMinimis) {
    flags.push({
      type: "de_minimis",
      severity: "info",
      message: `Under ${dest} de-minimis (${threshold} USD) — duty and tax waived`,
    });
  }

  // --- step 3: duty = lineValue × rate (live synced rate when unambiguous,
  //     else chapter override or destination default) ---
  const rates = DUTY_RATES[dest];
  const staticRate = rates ? rates.byChapter?.[chapter] ?? rates.default : 0;
  const dutyRate = underDeMinimis ? 0 : input.liveDutyRate ?? staticRate;
  const dutyAmount = round2(lineValue * dutyRate);

  // --- step 4: tax/VAT applied on (value + duty) ---
  const vatRate = underDeMinimis ? 0 : VAT_RATES[dest] ?? 0;
  const taxAmount = round2((lineValue + dutyAmount) * vatRate);

  return {
    dutyAmount,
    taxAmount,
    totalLandedCost: round2(lineValue + dutyAmount + taxAmount),
    complianceFlags: flags,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
