export default function Home() {
  return (
    <main style={{ maxWidth: 640 }}>
      <h1>SWIP Customs Pipeline</h1>
      <p>A production-shaped slice of a cross-border customs compliance pipeline.</p>
      <ul>
        <li>
          <code>POST /api/shipments</code> — ingest shipments as JSON
        </li>
        <li>
          <code>POST /api/imports</code> — ingest shipments as a CSV upload
        </li>
        <li>
          <code>/api/inngest</code> — Inngest serve endpoint (durable pipeline)
        </li>
      </ul>
      <p>Dashboard and review queue UI come next.</p>
    </main>
  );
}
