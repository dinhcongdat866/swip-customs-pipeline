import { listSyncRuns, countTariffRules } from "../../src/pipeline/tariff-rules.js";

export const dynamic = "force-dynamic";

/**
 * The "rules maintain themselves" ledger: what the nightly sync fetched from
 * the official USITC tariff export, what it auto-applied (new lines, rate
 * changes) and what it parked for a human (removals — a vanished code usually
 * means a restructuring, so it is never deleted automatically).
 */
export default async function RulesPage() {
  const [runs, ruleCount] = await Promise.all([listSyncRuns(20), countTariffRules("US")]);
  const latest = runs[0];
  const pending = latest?.pendingRemovals ?? [];

  return (
    <>
      <h1>Tariff rules sync</h1>
      <p className="sub">
        A nightly job fetches the official USITC tariff schedule, diffs it against the rules the duty
        step runs on, auto-applies the safe changes and parks the ambiguous ones for review.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Live rules</h2>
        <p style={{ margin: 0 }}>
          <strong>{ruleCount}</strong> US rate lines in <span className="mono">tariff_rules</span> —
          consulted by the duty step before the static fallback.
          {latest && (
            <span className="muted"> Last sync: {latest.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC.</span>
          )}
        </p>
      </div>

      {pending.length > 0 && (
        <div className="card" style={{ borderLeft: "3px solid var(--amber)" }}>
          <h2 style={{ marginTop: 0 }}>Pending removals — needs a human</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            These codes vanished from the source. That usually means a restructuring (split/merge), so
            the sync never deletes them automatically.
          </p>
          <ul style={{ margin: 0 }}>
            {pending.map((p) => (
              <li key={p.htsno}>
                <span className="mono">{p.htsno}</span> {p.description} <span className="muted">({p.rateRaw})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Sync history</h2>
        {runs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No runs yet — run <span className="mono">pnpm rules:sync</span> or wait for the nightly cron.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When (UTC)</th>
                <th>Source</th>
                <th>Added</th>
                <th>Rate changes</th>
                <th>Removals pending</th>
                <th>Unparsed rates</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td>{r.source.toUpperCase()} → {r.destination}</td>
                  <td className="mono">{r.added}</td>
                  <td className="mono">{r.changed}</td>
                  <td className="mono">{r.removedPending}</td>
                  <td className="mono">{r.unparsedRates}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
