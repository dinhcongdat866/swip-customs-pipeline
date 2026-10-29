import { and, eq, like, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { tariffRules, ruleSyncRuns, type PendingRemoval } from "../db/schema.js";

/**
 * The "automate the rules" loop Will asked about, made concrete:
 *
 *   fetch (USITC export, real JSON) → normalize → diff against what we run on
 *   → apply with a safety gate → record the run → the duty step reads the result.
 *
 * Safety gate: additions and rate changes are auto-applied (with the run ledger
 * as the audit trail); removals are NEVER auto-applied — a code disappearing
 * from the source usually means a restructuring (split/merge), so it is parked
 * for a human. Compound rates we can't parse are stored but never used as
 * numbers. Same philosophy as the confidence router: automate the safe part,
 * escalate the ambiguous part.
 *
 * Source: https://hts.usitc.gov/reststop/exportList — the official export
 * behind the site's "Export" button. `styles=false` is required or the server
 * answers 400. Rates live on the 8-digit legal lines ("6109.10.00" → "16.5%");
 * 10-digit statistical lines carry no rate and are skipped.
 */

const USITC_EXPORT = "https://hts.usitc.gov/reststop/exportList";

/** Chapters the demo pipeline actually meets (apparel, footwear, watches, toys, misc). */
export const DEFAULT_CHAPTERS = ["61", "62", "64", "91", "95", "96"];

export interface FetchedRule {
  htsno: string;
  code: string; // digits only
  description: string;
  rateRaw: string;
  rateParsed: number | null;
}

export interface SyncSummary {
  destination: string;
  chapters: string[];
  fetched: number;
  added: number;
  changed: number;
  removedPending: number;
  unparsedRates: number;
  pendingRemovals: PendingRemoval[];
}

/**
 * "Free" → 0, "16.5%" → 0.165, anything else (compound, specific per-unit) → null.
 * Deliberately conservative: a rate we can't fully understand must never
 * silently become a number in someone's landed cost.
 */
export function parseRate(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^free$/i.test(s)) return 0;
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(s);
  if (pct) return Number(pct[1]) / 100;
  return null;
}

interface UsitcRow {
  htsno: string | null;
  description: string | null;
  general: string | null;
}

/** Fetch one chapter's rate-bearing lines from the USITC export endpoint. */
export async function fetchChapterRules(chapter: string): Promise<FetchedRule[]> {
  const url = `${USITC_EXPORT}?from=${chapter}01&to=${chapter}99&format=JSON&styles=false`;
  const res = await fetch(url, { headers: { "User-Agent": "customs-pipeline/0.1" } });
  if (!res.ok) throw new Error(`USITC export ${chapter}: HTTP ${res.status}`);
  const rows = (await res.json()) as UsitcRow[];

  const out: FetchedRule[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const htsno = r.htsno?.trim();
    const rateRaw = r.general?.trim();
    if (!htsno || !rateRaw) continue; // group headers / statistical lines
    const code = htsno.replace(/\D/g, "");
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ htsno, code, description: r.description ?? "", rateRaw, rateParsed: parseRate(rateRaw) });
  }
  return out;
}

/**
 * Diff the fetched rules against the table and apply with the safety gate.
 * Idempotent by construction: running twice against the same source is a no-op
 * second time (0 added, 0 changed) — which is also the cheap self-test.
 */
export async function applyRulesDiff(
  destination: string,
  chapters: string[],
  fetched: FetchedRule[],
): Promise<SyncSummary> {
  const chapterSet = new Set(chapters);
  const existing = (await db.select().from(tariffRules).where(eq(tariffRules.destination, destination))).filter(
    (r) => chapterSet.has(r.code.slice(0, 2)),
  );
  const existingByCode = new Map(existing.map((r) => [r.code, r]));
  const fetchedByCode = new Map(fetched.map((r) => [r.code, r]));

  const toInsert = fetched.filter((r) => !existingByCode.has(r.code));
  const toUpdate = fetched.filter((r) => {
    const cur = existingByCode.get(r.code);
    return cur !== undefined && cur.rateRaw !== r.rateRaw;
  });
  const pendingRemovals: PendingRemoval[] = existing
    .filter((r) => !fetchedByCode.has(r.code))
    .map((r) => ({ htsno: r.htsno, description: r.description ?? undefined, rateRaw: r.rateRaw }));

  if (toInsert.length) {
    // chunked so a big first import stays under Postgres parameter limits
    for (let i = 0; i < toInsert.length; i += 500) {
      await db.insert(tariffRules).values(
        toInsert.slice(i, i + 500).map((r) => ({
          destination, code: r.code, htsno: r.htsno, description: r.description,
          rateRaw: r.rateRaw, rateParsed: r.rateParsed,
        })),
      );
    }
  }
  for (const r of toUpdate) {
    await db
      .update(tariffRules)
      .set({ rateRaw: r.rateRaw, rateParsed: r.rateParsed, description: r.description, effectiveFrom: new Date(), fetchedAt: new Date() })
      .where(and(eq(tariffRules.destination, destination), eq(tariffRules.code, r.code)));
  }

  const summary: SyncSummary = {
    destination, chapters,
    fetched: fetched.length,
    added: toInsert.length,
    changed: toUpdate.length,
    removedPending: pendingRemovals.length,
    unparsedRates: fetched.filter((r) => r.rateParsed === null).length,
    pendingRemovals,
  };
  await db.insert(ruleSyncRuns).values({
    source: "usitc", destination, status: "ok",
    added: summary.added, changed: summary.changed,
    removedPending: summary.removedPending, unparsedRates: summary.unparsedRates,
    pendingRemovals,
  });
  return summary;
}

/** Whole loop in one call — what `pnpm rules:sync` runs; Inngest runs the same two halves as separate steps. */
export async function runRulesSync(destination = "US", chapters = DEFAULT_CHAPTERS): Promise<SyncSummary> {
  const fetched: FetchedRule[] = [];
  for (const ch of chapters) fetched.push(...(await fetchChapterRules(ch)));
  return applyRulesDiff(destination, chapters, fetched);
}

/**
 * Duty-rate lookup for the assess step. Given the classifier's code (a 4-digit
 * heading like "6109" or a full "6109.10.00"), find live rows compatible with it
 * (prefix either way). Only answers when the answer is UNAMBIGUOUS — all
 * matching parsed rates agree; anything else returns null and the caller falls
 * back to the static reference map. A wrong duty number is worse than a
 * conservative default.
 */
export async function lookupLiveDutyRate(destination: string | null, hsCode: string): Promise<number | null> {
  if (!destination) return null;
  const digits = hsCode.replace(/\D/g, "");
  if (digits.length < 4) return null;
  const rows = await db
    .select({ code: tariffRules.code, rateParsed: tariffRules.rateParsed })
    .from(tariffRules)
    .where(and(eq(tariffRules.destination, destination), like(tariffRules.code, `${digits.slice(0, 4)}%`)));
  const rates = rows
    .filter((r) => r.code.startsWith(digits) || digits.startsWith(r.code))
    .map((r) => r.rateParsed)
    .filter((r): r is number => r !== null);
  if (!rates.length) return null;
  const first = rates[0]!;
  return rates.every((r) => r === first) ? first : null;
}

/** Latest sync runs for the /rules page, newest first. */
export async function listSyncRuns(limit = 20) {
  return db.select().from(ruleSyncRuns).orderBy(desc(ruleSyncRuns.createdAt)).limit(limit);
}

/** How many live rules the duty step can draw on. */
export async function countTariffRules(destination = "US"): Promise<number> {
  const rows = await db.select({ code: tariffRules.code }).from(tariffRules).where(eq(tariffRules.destination, destination));
  return rows.length;
}
