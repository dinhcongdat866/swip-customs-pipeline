# swip-customs-pipeline

A production-shaped slice of the **compliance + data infrastructure behind
cross-border parcel shipping**: ingest raw product data → classify (HS code) →
assess duty / tax / compliance → route by confidence → human-in-the-loop review →
a cleared customs declaration.

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
- [ ] **Step 2 — Ingest** (one pipeline, two front doors: CSV upload + API).
- [ ] **Step 3 — Inngest orchestration** (the 6-step per-shipment workflow).
- [ ] **Step 4 — Confidence router + risk score.**
- [ ] **Step 5 — Human-in-the-loop review queue.**
- [ ] **Step 6 — Scaling, cost, eval-in-CI.**

## Run it (local)

```bash
pnpm install
cp .env.example .env        # set DATABASE_URL + ANTHROPIC_API_KEY
pnpm db:up                  # local Postgres via docker compose
pnpm db:push                # apply the schema
pnpm db:studio              # browse the tables
```

Use a Supabase pooled connection string in `DATABASE_URL` to run against Supabase
instead — the schema is identical, only the URL changes.
