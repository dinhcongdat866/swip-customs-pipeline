import "dotenv/config";
import { runRulesSync, DEFAULT_CHAPTERS } from "../src/pipeline/tariff-rules.js";

/**
 * Run the tariff-rules sync once, by hand — same code the nightly Inngest cron
 * runs, without needing the dev server. Run it twice to see idempotency: the
 * second run reports 0 added / 0 changed.
 *
 *   pnpm rules:sync             # default chapters
 *   pnpm rules:sync 61 62       # specific chapters
 */
const chapters = process.argv.slice(2).filter((a) => /^\d{2}$/.test(a));
const summary = await runRulesSync("US", chapters.length ? chapters : DEFAULT_CHAPTERS);

console.log(`sync US chapters [${summary.chapters.join(", ")}]`);
console.log(`  fetched rate lines : ${summary.fetched}`);
console.log(`  added              : ${summary.added}`);
console.log(`  rate changes       : ${summary.changed}`);
console.log(`  removals (PENDING) : ${summary.removedPending}`);
console.log(`  unparsed rates     : ${summary.unparsedRates} (stored, never used as numbers)`);
for (const p of summary.pendingRemovals.slice(0, 10)) {
  console.log(`    pending removal: ${p.htsno} ${p.description ?? ""}`);
}
process.exit(0);
