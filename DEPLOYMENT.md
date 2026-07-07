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
| `PORT` | port to listen on (most hosts inject this for you) |
| `CORS_ORIGIN` | the deployed web app's origin, e.g. `https://your-app.vercel.app` |

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

Env var: `NEXT_PUBLIC_API_URL` — the public URL of the deployed server (e.g.
`https://line-calling-server.fly.dev`). This is a build-time value (Next.js
inlines `NEXT_PUBLIC_*` vars at build), so it must be set wherever the build
runs, not just at runtime.

**Vercel:** import the repo, set the root directory to `apps/web`, add
`NEXT_PUBLIC_API_URL` as a project env var. Vercel's Bun/Next detection handles
the rest.

**Docker:** build from the repo root with the API URL as a build arg:

```bash
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://line-calling-server.fly.dev \
  -t line-calling-web .
docker run -p 3100:3100 line-calling-web
```

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
