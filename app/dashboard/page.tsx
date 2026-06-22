import Link from "next/link";
import { listShipments, statusCounts } from "@/queries";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  cleared: "#16a34a",
  needs_review: "#d97706",
  blocked: "#dc2626",
  processing: "#2563eb",
  received: "#6b7280",
  failed: "#dc2626",
};

/** The customer-facing dashboard: every shipment is a filtered view of `status`. */
export default async function Dashboard() {
  const rows = await listShipments();
  const counts = await statusCounts(rows);

  return (
    <main style={{ maxWidth: 980 }}>
      <nav style={{ marginBottom: 16, display: "flex", gap: 16 }}>
        <Link href="/">← Home</Link>
        <Link href="/review">Review queue →</Link>
      </nav>
      <h1>Shipments</h1>

      <div style={{ display: "flex", gap: 12, margin: "12px 0 20px", flexWrap: "wrap" }}>
        {Object.entries(counts).map(([status, n]) => (
          <span key={status} style={{ padding: "4px 10px", borderRadius: 999, background: "#f3f4f6", fontSize: 14 }}>
            <b style={{ color: STATUS_COLOR[status] ?? "#111" }}>{n}</b> {status}
          </span>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e5e5" }}>
            <th style={th}>Product</th>
            <th style={th}>Route</th>
            <th style={th}>HS</th>
            <th style={th}>Conf</th>
            <th style={th}>Duty</th>
            <th style={th}>Tax</th>
            <th style={th}>Landed</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={td}>{s.rawTitle}</td>
              <td style={td}>
                {s.originCountry}→{s.destinationCountry}
              </td>
              <td style={td}>{s.hsCode ?? "—"}</td>
              <td style={td}>{s.hsConfidence?.toFixed(2) ?? "—"}</td>
              <td style={td}>{s.dutyAmount ?? "—"}</td>
              <td style={td}>{s.taxAmount ?? "—"}</td>
              <td style={td}>{s.totalLandedCost ?? "—"}</td>
              <td style={{ ...td, color: STATUS_COLOR[s.status] ?? "#111", fontWeight: 600 }}>{s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p style={{ color: "#888" }}>No shipments yet — POST to /api/shipments to ingest some.</p>}
    </main>
  );
}

const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "8px 10px" };
