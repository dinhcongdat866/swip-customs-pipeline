# swip-customs-pipeline

**▶ Live demo:** [swip-customs-pipeline.vercel.app](https://swip-customs-pipeline.vercel.app) —
[dashboard](https://swip-customs-pipeline.vercel.app/dashboard) ·
[review queue](https://swip-customs-pipeline.vercel.app/review)

A production-shaped slice of the **compliance + data infrastructure behind
cross-border parcel shipping**: ingest raw product data → classify (HS code) →
assess duty / tax / compliance → route by confidence → human-in-the-loop review →
a cleared customs declaration.

> The live demo is seeded with realistic data so the link always renders; the
> classifier itself calls Anthropic for real (see `pnpm pipeline` and the
> [eval study](https://github.com/dinhcongdat866/hs-code-classifier)).

Built to match the stack in the role (**Next.js · TypeScript · Postgres/Supabase ·
Inngest · Anthropic**) and to turn the tradeoffs from my written exercise into
working code instead of prose. It extends my earlier eval study,
[`hs-code-classifier`](https://github.com/dinhcongdat866/hs-code-classifier),
from an offline measurement into a real workflow.

> **Why this shape:** every parcel crossing a border needs a valid declaration —
> classified, duty-and-tax assessed, compliance-checked — **fast, accurate, and
> cheap, at the scale of millions of parcels.** The whole design is about
> balancing speed, accuracy, and cost while never letting a *silent* wrong
> classification through.

## The core idea

The eval study found the realistic way to ship this today is **AI suggests, a
human confirms the uncertain ones**: top-1 accuracy ≈ 59%, but the correct code is
in the top-3 ≈ 79% of the time. So the pipeline is built around a **confidence
router**:

```
high confidence + low risk   → auto-clear
uncertain / high value       → human review queue (pick 1 of top-3)
prohibited / denied party    → block
```

Automation is the goal — but it's *earned* as the data proves each slice is safe,
not assumed up front.

## Architecture

```
Next.js (Vercel)      UI: upload, dashboard, review queue + ingest API
Inngest               durable orchestration: 1 shipment = 1 workflow; retries,
                      fan-out, and pause-for-human-review
Postgres (Supabase)   shipments · classifications · reviews · audit_log · cache
Anthropic SDK         classifier — reuses prompt v2 from the eval study
```

Design rationale (every table, every field, the actors, the I/O glossary, and the
schema-evolution / migration strategy) lives in **[DESIGN.md](DESIGN.md)**.

## Status

This is built in steps; each step is a real design decision documented in
`DESIGN.md`.

- [x] **Step 1 — Data model.** Postgres schema: a `shipments` state machine
      surrounded by append-only `classifications` + `audit_log`, and a
      content-addressed classification cache.
- [x] **Step 2 — Ingest** (one pipeline, two front doors: CSV + API →
      `src/ingest.ts`). Deterministic, rule-based title normalization.
- [x] **Step 3 — Pipeline.** Six thin steps — normalize → classify (real
      Anthropic, v2 prompt) → duty → tax → compliance → route — as both a plain
      orchestrator (`src/pipeline/run.ts`) and a **durable Inngest workflow**
      (`src/inngest/functions.ts`) with per-step retries and `waitForEvent` for
      human review.
- [x] **Step 4 — Confidence router** (`src/pipeline/route.ts`): auto-clear vs
      human review vs block, with a higher confidence bar for high-value parcels.
- [x] **Step 5 — Next.js app + review queue.** Real ingest endpoints
      (`/api/shipments`, `/api/imports`), the Inngest serve route, a `/dashboard`
      view of the `status` state machine, and a `/review` queue where a human
      picks one of the top-3 — emitting `review/completed` to wake the paused
      durable workflow.
- [ ] **Step 6 — Scaling, cost, eval-in-CI.**

## Run it (local)

```bash
pnpm install
cp .env.example .env        # set DATABASE_URL + ANTHROPIC_API_KEY
pnpm db:up                  # local Postgres via docker compose
pnpm db:push                # apply the schema

pnpm pipeline               # ingest 3 sample shipments + run the pipeline live
pnpm db:studio              # browse shipments / classifications / audit_log
```

`pnpm pipeline` runs the plain orchestrator (no Inngest needed) so you can watch
the six steps against real Anthropic + Postgres. The Inngest version runs the
same steps durably via the Inngest dev server (wired up with the Next.js app in
Step 5). Use a Supabase pooled connection string in `DATABASE_URL` to run against
Supabase instead — the schema is identical, only the URL changes.
