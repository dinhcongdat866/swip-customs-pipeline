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
    <main>
      <h1>Review queue {items.length > 0 && <span className="muted">({items.length})</span>}</h1>
      <p className="sub">Shipments the confidence router wasn't sure about. Pick one of the AI's top-3.</p>

      {items.length === 0 && <div className="card muted">Nothing waiting — every shipment cleared or was blocked.</div>}

      {items.map(({ shipment: s, candidates }) => (
        <div key={s.id} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <strong>{s.rawTitle}</strong>
            <span className="muted" style={{ whiteSpace: "nowrap" }}>
              {s.originCountry} → {s.destinationCountry} · {s.declaredValue} {s.currency}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 14, margin: "4px 0 14px" }}>
            AI confidence {s.hsConfidence?.toFixed(2) ?? "—"} · best guess {s.hsCode ?? "—"}
          </div>
          <ReviewForm shipmentId={s.id} candidates={candidates} />
        </div>
      ))}
    </main>
  );
}
