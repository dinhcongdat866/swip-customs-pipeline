import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// Default to the local docker Postgres when unset, so importing this module never
// throws at build time (Next evaluates route modules during `next build`). Real
// queries still need a reachable DB; set DATABASE_URL for Supabase.
const url = process.env.DATABASE_URL ?? "postgres://swip:swip@localhost:5432/swip";
const isLocal = url.includes("localhost") || url.includes("127.0.0.1");

// One shared connection. With Supabase use the *pooled* connection string so many
// concurrent serverless invocations don't exhaust Postgres connections.
//  - prepare:false  — Supabase's transaction pooler (port 6543) rejects prepared
//                     statements; harmless on a direct/local connection too.
//  - ssl 'require'  — hosted Postgres needs TLS; local docker doesn't.
const client = postgres(url, {
  max: 10,
  prepare: false,
  ssl: isLocal ? false : "require",
});

export const db = drizzle(client, { schema });
export { schema };
