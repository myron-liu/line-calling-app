// Bun API server. Persists teams/players/tournaments/saved-lines/games to
// Supabase Postgres via Drizzle (see src/db). The live game itself stays
// client-authoritative and offline-first (apps/web keeps its localStorage log);
// this server durably stores whatever the client already computed via one
// coarse `PUT /games/:id/sync` call rather than re-validating a state machine
// it doesn't own — see src/db/queries.ts's syncGame for the full rationale.

import { corsHeaders, json } from "./http";
import { matchPath, routes } from "./routes";

const PORT = Number(process.env.PORT ?? 4000);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (url.pathname === "/health") return json({ ok: true });

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (params) return route.handler(req, params);
    }
    return json({ error: "not_found" }, 404);
  },
});

console.log(`line-calling server listening on http://localhost:${server.port}`);
