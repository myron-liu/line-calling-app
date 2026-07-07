// Postgres connection (Supabase) via postgres.js + Drizzle. One pooled client for
// the whole process — Bun.serve is single-process, so a module-level singleton is
// fine (no per-request connection churn).

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy apps/server/.env.example to .env and fill in " +
      "your Supabase connection string (Project Settings → Database → Connection string, " +
      "use the 'Transaction' pooler URI on port 6543 for serverless-friendly pooling).",
  );
}

// Supabase's pooler (pgbouncer, transaction mode) doesn't support prepared
// statements, so they're disabled here; safe either way since Drizzle only
// prepares per-query, not across requests.
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
