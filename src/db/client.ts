import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// Default to the local docker Postgres when unset, so importing this module never
// throws at build time (Next evaluates route modules during `next build`). Real
// queries still need a reachable DB; set DATABASE_URL for Supabase.
const url = process.env.DATABASE_URL ?? "postgres://swip:swip@localhost:5432/swip";

// One shared connection. With Supabase use the *pooled* connection string so
// many concurrent Inngest workers don't exhaust Postgres connections.
const client = postgres(url, { max: 10 });

export const db = drizzle(client, { schema });
export { schema };
