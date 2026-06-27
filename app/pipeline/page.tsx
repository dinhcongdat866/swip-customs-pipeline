"use client";

import { useState } from "react";

interface Step {
  title: string;
  one: string;
  what: string;
  example: React.ReactNode;
  ai: boolean;
}

const STEPS: Step[] = [
  {
    title: "Ingest",
    one: "Hardware comes in",
    ai: false,
    what: "A shipment arrives — one product, or a batch of thousands — through a JSON API or a CSV upload. Both go through the exact same pipeline; only the front door differs. Each item is saved and the pipeline is kicked off.",
    example: <>A carrier sends: <span className="mono">"Cute Cat Hoodie Soft Warm XL Gift", $120, made in CN, shipping to JP</span>.</>,
  },
  {
    title: "Normalize",
    one: "Clean the title",
    ai: false,
    what: "Real product titles are messy and full of marketing words. We strip them down to a stable form using simple rules — deliberately NOT AI, because this output is used as a cache key and a key must be perfectly reproducible. Identical products collapse to the same form so we can reuse past work.",
    example: <><span className="mono">"Cute Cat Hoodie Soft Warm XL Gift"</span> → <span className="mono">"cat cotton hoodie xl"</span></>,
  },
  {
    title: "Classify",
    one: "AI suggests codes",
    ai: true,
    what: "We ask the AI (Claude) for the 3 most likely customs (HS) codes, with a confidence score. If we've classified this exact product before, we reuse the cached answer instead of paying for another AI call — the biggest cost saver at scale.",
    example: <>→ <span className="mono">6110</span> knit pullover (0.91), <span className="mono">6109</span> t-shirt, <span className="mono">6205</span> woven shirt</>,
  },
  {
    title: "Duty & Tax",
    one: "Calculate the money",
    ai: false,
    what: "From the code, value, origin and destination, we compute the import duty and the destination's tax — deterministically, so the numbers are reproducible and auditable. This is the 'total landed cost' a buyer ultimately pays.",
    example: <>Chapter 61 into Japan: 9% duty + 10% consumption tax on $120 → <span className="mono">$143.88 landed</span></>,
  },
  {
    title: "Compliance",
    one: "Check the rules",
    ai: false,
    what: "Flag anything restricted, prohibited, or that needs a licence — plus de-minimis thresholds where small shipments are tax-free. A hard 'block' flag means the parcel can never auto-clear, no matter how confident the AI is.",
    example: <>Ammunition (chapter 93) → <span className="mono">blocked</span>. A $15 item under Japan's threshold → duty waived.</>,
  },
  {
    title: "Route",
    one: "Decide the outcome",
    ai: false,
    what: "The product thesis in one step. High confidence + low risk → auto-clear. Uncertain, or high value → send to a human to confirm. Prohibited → block. Automation is earned as the data proves each slice is safe, not assumed up front.",
    example: <>0.91 confidence → <span className="mono">cleared</span>. A $1,450 watch at 0.74 → <span className="mono">needs review</span>.</>,
  },
];

export default function PipelinePage() {
  const [active, setActive] = useState(0);
  const step = STEPS[active]!;

  return (
    <main>
      <h1>How the pipeline works</h1>
      <p className="sub">Six steps turn a messy product title into a cleared customs declaration. Click any step.</p>

      <div className="flow">
        {STEPS.map((s, i) => (
          <button key={i} className={`flow-step${i === active ? " active" : ""}`} onClick={() => setActive(i)}>
            <span className="flow-num">{i + 1}</span>
            <div className="flow-title">{s.title}</div>
            <div className="flow-one">{s.one}</div>
          </button>
        ))}
      </div>

      <div className="flow-detail">
        <h3>
          {active + 1}. {step.title}{" "}
          <span className={`badge badge-${step.ai ? "processing" : "cleared"}`} style={{ verticalAlign: "middle", fontSize: 11 }}>
            {step.ai ? "AI" : "deterministic"}
          </span>
        </h3>
        <div>{step.what}</div>
        <div className="flow-example">Example &nbsp;{step.example}</div>
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: 24 }}>
        Want to see it run? <a href="/classify">Try it live →</a>
      </p>
    </main>
  );
}
