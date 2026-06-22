"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Candidate } from "@/db/schema";

/**
 * One reviewer's controls for a shipment: pick one of the AI's top-3, or override
 * with a code of their own. Submitting POSTs to /api/reviews (which emits the
 * resume event) and refreshes the queue.
 */
export function ReviewForm({ shipmentId, candidates }: { shipmentId: string; candidates: Candidate[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [override, setOverride] = useState("");
  const [done, setDone] = useState(false);

  async function submit(chosenHsCode: string, pickedFromCandidates: "yes" | "override") {
    await fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shipmentId, chosenHsCode, pickedFromCandidates, reviewer: "you" }),
    });
    setDone(true);
    startTransition(() => router.refresh());
  }

  if (done) return <span style={{ color: "#16a34a" }}>✓ submitted — workflow resuming…</span>;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {candidates.map((c, i) => (
        <button
          key={c.hsCode + i}
          disabled={pending}
          onClick={() => submit(c.hsCode, "yes")}
          title={c.reasoning}
          style={btn(i === 0)}
        >
          {c.hsCode}
          {c.label ? ` · ${c.label}` : ""}
        </button>
      ))}
      <span style={{ color: "#999" }}>or</span>
      <input
        value={override}
        onChange={(e) => setOverride(e.target.value)}
        placeholder="override code"
        style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: 6, width: 120 }}
      />
      <button disabled={pending || !override} onClick={() => submit(override, "override")} style={btn(false)}>
        override
      </button>
    </div>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid",
    borderColor: primary ? "#2563eb" : "#ccc",
    background: primary ? "#2563eb" : "#fff",
    color: primary ? "#fff" : "#111",
    cursor: "pointer",
  };
}
