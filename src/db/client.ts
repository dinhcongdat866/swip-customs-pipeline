import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

// One shared connection. With Supabase use the *pooled* connection string so
// many concurrent Inngest workers don't exhaust Postgres connections.
const client = postgres(url, { max: 10 });

export const db = drizzle(client, { schema });
export { schema };
