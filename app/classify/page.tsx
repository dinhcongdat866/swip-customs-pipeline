"use client";

import { useState } from "react";

interface Result {
  normalized: string;
  classification: { candidates: { hsCode: string; label?: string; reasoning?: string }[]; hsCode: string; confidence: number; latencyMs: number; costUsd: number; model: string };
  assessment: { dutyAmount: number; taxAmount: number; totalLandedCost: number; complianceFlags: { type: string; severity: string; message: string }[] };
  decision: { status: "cleared" | "needs_review" | "blocked"; reason: string };
}

const EXAMPLES = [
  { rawTitle: "Cute Cat Hoodie Soft Warm Winter XL Gift", material: "cotton, knit", declaredValue: "120", destinationCountry: "JP" },
  { rawTitle: "Stainless Steel Vacuum Insulated Tumbler 20oz", declaredValue: "18", destinationCountry: "US" },
  { rawTitle: "Hunting Rifle Ammunition Cartridges Box of 50", declaredValue: "40", destinationCountry: "JP" },
];

export default function ClassifyPlayground() {
  const [apiKey, setApiKey] = useState("");
  const [form, setForm] = useState({ rawTitle: "", material: "", declaredValue: "", currency: "USD", originCountry: "CN", destinationCountry: "JP", quantity: "1" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  function set(k: keyof typeof form, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/classify-live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "request failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Classify a product, live</h1>
      <p className="sub">
        Runs the real pipeline — classify (Anthropic) → duty/tax → compliance → route — on one product.
        Your API key is used for this single call and never stored.
      </p>

      <div className="card">
        <div className="field">
          <label className="label">Anthropic API key</label>
          <input className="input" type="password" placeholder="sk-ant-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Product title</label>
          <input className="input" placeholder="e.g. Cute Cat Hoodie Soft Warm XL Gift" value={form.rawTitle} onChange={(e) => set("rawTitle", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Material (optional)</label>
          <input className="input" placeholder="e.g. cotton, knit" value={form.material} onChange={(e) => set("material", e.target.value)} />
        </div>
        <div className="row">
          <div className="field">
            <label className="label">Declared value</label>
            <input className="input" value={form.declaredValue} onChange={(e) => set("declaredValue", e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Currency</label>
            <input className="input" value={form.currency} onChange={(e) => set("currency", e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label className="label">Origin</label>
            <input className="input" value={form.originCountry} onChange={(e) => set("originCountry", e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Destination</label>
            <input className="input" value={form.destinationCountry} onChange={(e) => set("destinationCountry", e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
          <button className="btn" onClick={run} disabled={loading || !apiKey || !form.rawTitle}>
            {loading ? "Classifying…" : "Classify"}
          </button>
          <span className="muted" style={{ fontSize: 13 }}>or try:</span>
          {EXAMPLES.map((ex, i) => (
            <button key={i} className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }}
              onClick={() => setForm((f) => ({ ...f, rawTitle: ex.rawTitle, material: ex.material ?? "", declaredValue: ex.declaredValue, destinationCountry: ex.destinationCountry }))}>
              {ex.rawTitle.split(" ").slice(0, 2).join(" ")}…
            </button>
          ))}
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>⚠ {error}</div>}

      {result && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Result</h2>
            <span className={`badge badge-${result.decision.status}`}>{result.decision.status.replace("_", " ")}</span>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>{result.decision.reason}</p>

          <h2>Top-3 candidates</h2>
          {result.classification.candidates.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid #f1f3f5" }}>
              <strong className="mono" style={{ minWidth: 60 }}>{c.hsCode}</strong>
              <div>
                <div>{c.label}</div>
                {c.reasoning && <div className="muted" style={{ fontSize: 13 }}>{c.reasoning}</div>}
              </div>
            </div>
          ))}

          <h2>Assessment</h2>
          <table>
            <tbody>
              <tr><td className="muted">AI confidence (self-reported)</td><td className="mono">{result.classification.confidence.toFixed(2)}</td></tr>
              <tr><td className="muted">Duty</td><td className="mono">${result.assessment.dutyAmount.toFixed(2)}</td></tr>
              <tr><td className="muted">Tax</td><td className="mono">${result.assessment.taxAmount.toFixed(2)}</td></tr>
              <tr><td className="muted">Total landed cost</td><td className="mono">${result.assessment.totalLandedCost.toFixed(2)}</td></tr>
              <tr><td className="muted">Model · latency · cost</td><td className="mono">{result.classification.model} · {(result.classification.latencyMs / 1000).toFixed(1)}s · ${result.classification.costUsd.toFixed(4)}</td></tr>
            </tbody>
          </table>

          {result.assessment.complianceFlags.length > 0 && (
            <>
              <h2>Compliance flags</h2>
              {result.assessment.complianceFlags.map((f, i) => (
                <div key={i} style={{ fontSize: 14, color: f.severity === "block" ? "var(--red)" : "var(--amber)" }}>• {f.message}</div>
              ))}
            </>
          )}

          <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
            normalized title (cache key input): <span className="mono">{result.normalized}</span>
          </p>
        </div>
      )}
    </main>
  );
}
