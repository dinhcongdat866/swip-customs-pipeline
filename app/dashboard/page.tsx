import { listShipments, statusCounts } from "@/queries";

export const dynamic = "force-dynamic";

/** The customer-facing dashboard: every shipment is a filtered view of `status`. */
export default async function Dashboard() {
  const rows = await listShipments();
  const counts = await statusCounts(rows);

  return (
    <main>
      <h1>Shipments</h1>
      <p className="sub">Each row is a filtered view of one column — <span className="mono">status</span>.</p>

      <div style={{ display: "flex", gap: 10, margin: "0 0 20px", flexWrap: "wrap" }}>
        {Object.entries(counts).map(([status, n]) => (
          <span key={status} className={`badge badge-${status}`}>{n} {status.replace("_", " ")}</span>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Route</th><th>HS</th><th>Conf</th><th>Duty</th><th>Tax</th><th>Landed</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{s.rawTitle}</td>
                <td className="muted">{s.originCountry}→{s.destinationCountry}</td>
                <td className="mono">{s.hsCode ?? "—"}</td>
                <td className="mono">{s.hsConfidence?.toFixed(2) ?? "—"}</td>
                <td className="mono">{s.dutyAmount ?? "—"}</td>
                <td className="mono">{s.taxAmount ?? "—"}</td>
                <td className="mono">{s.totalLandedCost ?? "—"}</td>
                <td><span className={`badge badge-${s.status}`}>{s.status.replace("_", " ")}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="muted">No shipments yet — POST to /api/shipments or seed demo data.</p>}
    </main>
  );
}
