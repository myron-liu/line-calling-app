# Deployment

The app is three deployable pieces:

- **Database** — a Supabase Postgres project.
- **`apps/server`** — a Bun API (Drizzle ORM) that owns teams/players/tournaments/
  saved-lines/games and durably stores the live game (see its `src/index.ts`).
- **`apps/web`** — the Next.js app. The live game itself runs offline in the
  browser (`localStorage`) and syncs to `apps/server` opportunistically; every
  other screen calls the API directly.

None of this is tied to a specific host — pick whatever runs a Docker container
(or a bare Bun/Node process) for the server, and whatever runs Next.js for the
web app. The steps below are host-agnostic; a Vercel + Fly.io/Railway/Render
pairing is a common, easy combination but not required.

## 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **Project Settings → Database → Connection string** gives you two URIs you'll
   need (same credentials, different ports):
   - **Transaction pooler** (port 6543) — for the running server. Set this as
     `DATABASE_URL` wherever `apps/server` runs.
   - **Session pooler** (port 5432) or the direct connection string — for
     running migrations (DDL doesn't work reliably through the transaction
     pooler). Use this once, not as the server's persistent `DATABASE_URL`.
3. Run the schema migration once, from your machine or CI, against the
   session/direct URI:
   ```bash
   cd apps/server
   DATABASE_URL="<session-or-direct-uri>" bun run db:migrate
   ```
   Re-run this after pulling any change to `apps/server/src/db/schema.ts` (a new
   migration file will exist under `src/db/migrations`, generated with
   `bun run db:generate`).

## 2. `apps/server`

Env vars (see `apps/server/.env.example`):

| Var | Value |
|---|---|
| `DATABASE_URL` | Supabase transaction pooler URI (port 6543) |
| `SUPABASE_URL` | same project's URL, e.g. `https://xxxxxxxxxxxx.supabase.co` — used to verify Supabase Auth JWTs (see `src/auth.ts`), no separate credentials needed |
| `PORT` | port to listen on (most hosts inject this for you) |
| `CORS_ORIGIN` | the deployed web app's origin, e.g. `https://your-app.vercel.app` |

Every route requires a valid Supabase phone-auth session and (for anything
scoped to a team) membership in that team's manager list — see §4.0 in
`line-calling-app-design.md` and `src/auth.ts`/`src/routes.ts`'s `authedRoute`.
Enable the **Phone** provider under Authentication → Providers in the Supabase
dashboard, with an SMS provider (Twilio, etc.) configured there, before this
will actually deliver OTP codes.

Build and run with the provided Dockerfile (build context is the **repo root**,
since the server needs the `packages/game-rules` workspace package):

```bash
docker build -f apps/server/Dockerfile -t line-calling-server .
docker run -p 4000:4000 --env-file apps/server/.env line-calling-server
```

Push that image to any container host (Fly.io, Railway, Render, a VM, etc.), or
skip Docker entirely and run `bun install && bun run start` directly from
`apps/server` on a host with Bun installed. Either way, run the migration step
above **before** the first deploy and after every schema change — the server
does not run migrations on boot (see the comment in `apps/server/Dockerfile`).

## 3. `apps/web`

Env vars — all build-time values (Next.js inlines `NEXT_PUBLIC_*` vars at
build), so they must be set wherever the build runs, not just at runtime:

| Var | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | the public URL of the deployed server, e.g. `https://line-calling-server.fly.dev` |
| `NEXT_PUBLIC_SUPABASE_URL` | same Supabase project as above |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → "anon public" key — safe to expose to the browser |

**Vercel:** import the repo, set the root directory to `apps/web`, add all
three as project env vars. Vercel's Bun/Next detection handles the rest.

**Docker:** build from the repo root with these as build args:

```bash
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://line-calling-server.fly.dev \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  -t line-calling-web .
docker run -p 3100:3100 line-calling-web
```

**Fly.io:** these build args are persisted in `fly.web.toml`'s `[build.args]`
rather than passed on the `fly deploy` command line — a plain `fly deploy`
without them silently falls back to the Dockerfile's defaults (`localhost:4000`
for the API URL, empty for the Supabase vars), which breaks every API call and
login from a real browser. If you ever add another `NEXT_PUBLIC_*` var, add it
there too rather than relying on remembering a CLI flag on every deploy.

The Dockerfile also bakes in `NEXT_PUBLIC_APP_VERSION` automatically (a build
timestamp — no action needed) so a client with an older build cached in
localStorage clears it on next load instead of risking a stale shape against
new code (see `lib/storage/store.ts`'s `sweepStaleStorageOnNewBuild`).

## 4. Local dev with Docker Compose

`docker-compose.yml` at the repo root runs a throwaway local Postgres plus both
apps, useful for testing the production Dockerfiles without touching Supabase:

```bash
docker compose up --build
docker compose run --rm server bun run db:migrate   # once, before first use
```

Web → http://localhost:3100, server → http://localhost:4000. This is a
convenience for local testing, not a production database — production always
points `DATABASE_URL` at Supabase.

For day-to-day development, running `bun run dev:web` and `bun run dev:server`
directly (see the main [README](./README.md)) is faster than rebuilding
containers on every change.

## 5. CI

`.github/workflows/ci.yml` runs on every push/PR: install, typecheck every
workspace, run the `@shared/game-rules` test suite, and build `apps/web`. It
doesn't deploy anything — wire your host's own deploy hook (Vercel's Git
integration, a Fly/Railway GitHub Action, etc.) on top of a green CI run.
