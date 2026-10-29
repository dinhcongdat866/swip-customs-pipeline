# Deploying to Vercel + Supabase

Goal: a live, clickable demo — `/dashboard` and `/review` populated with realistic
data — that an interviewer can open cold. The static demo needs only Postgres
(Supabase). The live pipeline (real Anthropic + Inngest) is optional and additive.

## 1. Supabase Postgres

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Project → **Connect** → **ORMs / Connection string** → copy the **Transaction
   pooler** URI (host ends in `pooler.supabase.com`, port `6543`). Put the DB
   password into it.

## 2. Create the schema + seed demo data (run locally, pointed at Supabase)

```bash
# PowerShell
$env:DATABASE_URL="postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres"
pnpm db:push          # create the tables in Supabase
pnpm seed:demo        # insert the 6 demo shipments (no Anthropic call, free)
```

After this, the Supabase Table Editor shows `shipments`, `classifications`, etc.

## 3. Deploy on Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → import
   `dinhcongdat866/customs-pipeline` from GitHub.
2. **Environment Variables** → add `DATABASE_URL` = the same Supabase pooler URI.
3. **Deploy.** Then open `https://<your-app>.vercel.app/dashboard`.

That's the demo link. The dashboard shows cleared / needs_review / blocked
shipments; `/review` shows the two `needs_review` items with the AI's top-3.

## 4. (Optional) Live pipeline — real Anthropic + Inngest

Only if you want to ingest live during a screen-share. The seeded demo above does
**not** need this.

- Add `ANTHROPIC_API_KEY` to Vercel env (classifier runs on real calls, costs $).
- Create an [Inngest](https://www.inngest.com) app, add `INNGEST_EVENT_KEY` and
  `INNGEST_SIGNING_KEY` to Vercel, and register the app URL
  `https://<your-app>.vercel.app/api/inngest` in the Inngest dashboard.
- Then `POST /api/shipments` fans out events → Inngest runs `classifyShipment`
  durably → `needs_review` items pause on `waitForEvent` until reviewed in `/review`.

## Notes

- The `postgres` client uses `prepare: false` + `ssl: require` for the Supabase
  pooler; locally it falls back to no-SSL automatically.
- Re-running `pnpm seed:demo` adds another batch; clear the tables in Supabase
  first if you want a single clean batch.
