import type { Config } from "drizzle-kit";

// `drizzle-kit generate` only reads schema.ts (no DB connection needed).
// `drizzle-kit migrate` needs DATABASE_URL set (see .env.example).
export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://placeholder/placeholder",
  },
} satisfies Config;
