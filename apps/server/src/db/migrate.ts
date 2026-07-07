// Runs pending migrations against DATABASE_URL. Safe to re-run (drizzle tracks
// applied migrations in a `__drizzle_migrations` table). Used by `bun run migrate`
// and by the production entrypoint before the server starts serving traffic.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set (see apps/server/.env.example).");
}

// Migrations need a plain, unpooled connection (DDL doesn't work well through
// pgbouncer transaction pooling) — use Supabase's direct connection URI here,
// or the session pooler (port 5432), not the transaction pooler (port 6543).
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

console.log("Running migrations...");
await migrate(db, { migrationsFolder: "./src/db/migrations" });
console.log("Migrations complete.");
await client.end();
