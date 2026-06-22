import Link from "next/link";
import { listReviewQueue } from "@/queries";
import { ReviewForm } from "./review-form";

export const dynamic = "force-dynamic"; // always read the live queue

/**
 * The human-in-the-loop review queue. Each card is a shipment the router sent to
 * `needs_review`; the reviewer picks one of the AI's top-3 (or overrides), which
 * emits `review/completed` and wakes the paused durable workflow.
 */
export default async function ReviewQueue() {
  const items = await listReviewQueue();

  return (
    <main style={{ maxWidth: 820 }}>
      <nav style={{ marginBottom: 16 }}>
        <Link href="/dashboard">← Dashboard</Link>
      </nav>
      <h1>Review queue {items.length > 0 && <span style={{ color: "#888" }}>({items.length})</span>}</h1>

      {items.length === 0 && <p style={{ color: "#888" }}>Nothing waiting — every shipment cleared or was blocked.</p>}

      {items.map(({ shipment: s, candidates }) => (
        <div key={s.id} style={{ border: "1px solid #e5e5e5", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <strong>{s.rawTitle}</strong>
            <span style={{ color: "#888", whiteSpace: "nowrap" }}>
              {s.originCountry} → {s.destinationCountry} · {s.declaredValue} {s.currency}
            </span>
          </div>
          <div style={{ color: "#666", fontSize: 14, margin: "4px 0 12px" }}>
            AI confidence {s.hsConfidence?.toFixed(2) ?? "—"} · best guess {s.hsCode ?? "—"}
          </div>
          <ReviewForm shipmentId={s.id} candidates={candidates} />
        </div>
      ))}
    </main>
  );
}
