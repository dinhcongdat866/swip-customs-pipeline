import { createHash } from "node:crypto";

/**
 * Marketing fluff that appears in real marketplace titles but carries no
 * classification signal. Stripped so two listings of the same product collapse
 * to the same normalized form. Deliberately conservative — see cache note below.
 */
const FLUFF = new Set([
  "cute", "soft", "warm", "cozy", "gift", "best", "premium", "new", "hot", "sale",
  "free", "shipping", "quality", "fashion", "style", "trendy", "luxury", "pcs", "pack",
]);

/**
 * Turn a dirty title into a stable, comparable form. **Deterministic and
 * rule-based — never an LLM**, because the output is used as a cache key and a
 * key must be reproducible. Conservative on purpose: it collapses trivial
 * variation (case, punctuation, fluff, word order) but will NOT unify
 * differently-worded-but-same products — a cache *miss* is harmless, a false
 * *hit* is the danger. Semantic dedup is a later pgvector upgrade.
 */
export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // strip punctuation/emoji, keep letters/numbers
    .split(/\s+/)
    .filter((w) => w && !FLUFF.has(w))
    .sort() // word order shouldn't matter: "red hoodie" == "hoodie red"
    .join(" ")
    .trim();
}

/** Content-addressed cache key. Same product + same destination → same key. */
export function cacheKey(normalizedTitle: string, destinationCountry: string | null): string {
  return createHash("sha256")
    .update(`${normalizedTitle}|${destinationCountry ?? ""}`)
    .digest("hex");
}
