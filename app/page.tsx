import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 680 }}>
      <h1>Customs Pipeline</h1>
      <p className="sub">
        A production-shaped slice of a cross-border customs compliance pipeline: ingest product data →
        classify (HS code) → assess duty / tax / compliance → route by confidence → human-in-the-loop review.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Explore</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
          <li><Link href="/classify">Try it live</Link> — type a product, paste your Anthropic key, watch the AI classify it</li>
          <li><Link href="/dashboard">Dashboard</Link> — shipments as a filtered view of the status state machine</li>
          <li><Link href="/review">Review queue</Link> — pick one of the AI's top-3 for the uncertain ones</li>
        </ul>
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: 20 }}>
        Built to match the stack in the role: Next.js · TypeScript · Postgres/Supabase · Inngest · Anthropic.
      </p>
    </main>
  );
}
