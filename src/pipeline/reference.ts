/**
 * Thin reference tables for the duty / tax / compliance steps. In production
 * these are real tariff schedules and sanctions lists behind their own service;
 * here they're small static maps so the whole pipeline runs end-to-end. The
 * *shape* is what matters — swapping in a real data source changes nothing above.
 */

/** FX → USD. We compute everything in USD; multi-currency is intentionally thin. */
export const FX_TO_USD: Record<string, number> = {
  USD: 1, JPY: 0.0067, EUR: 1.08, GBP: 1.27, CNY: 0.14,
};

/** Import duty rate by destination, with a few HS-chapter overrides. */
export const DUTY_RATES: Record<string, { default: number; byChapter?: Record<string, number> }> = {
  JP: { default: 0.0, byChapter: { "61": 0.09, "62": 0.09, "64": 0.20, "22": 0.15 } },
  US: { default: 0.0, byChapter: { "61": 0.16, "62": 0.16, "64": 0.10 } },
  GB: { default: 0.0, byChapter: { "61": 0.12, "62": 0.12 } },
};

/** Destination consumption tax / VAT, applied on (value + duty). */
export const VAT_RATES: Record<string, number> = { JP: 0.10, US: 0.0, GB: 0.20, EU: 0.20 };

/** Below this (USD) most destinations waive duty/tax — the de-minimis threshold. */
export const DE_MINIMIS_USD: Record<string, number> = { JP: 70, US: 800, GB: 180 };

/**
 * Restricted / prohibited goods keyed by HS chapter (first 2 digits). Real
 * systems also screen denied parties and per-country licence rules; this is the
 * minimum to show the compliance step producing real flags.
 */
export const RESTRICTED_CHAPTERS: Record<
  string,
  { type: "prohibited" | "restricted" | "license_required"; severity: "warn" | "block"; message: string }
> = {
  "93": { type: "prohibited", severity: "block", message: "Arms and ammunition — prohibited for parcel shipping" },
  "30": { type: "license_required", severity: "warn", message: "Pharmaceuticals may require an import licence" },
  "22": { type: "license_required", severity: "warn", message: "Alcoholic beverages require a licence / age checks" },
  "97": { type: "restricted", severity: "warn", message: "Works of art — may need export/cultural clearance" },
};
