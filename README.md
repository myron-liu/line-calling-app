# Line Calling App

An ultimate frisbee **line-calling** app for coaches: pick the right 7 for each
point while the app enforces the gender ratio (ABBA in Mixed), tracks O/D, score,
half, timeouts, injuries, and playing time. Built to run on a phone on the sideline.
See the [design doc](./line-calling-app-design.md) for the full spec.

> **v0 is public.** No login — teams, rosters, tournaments, and games are shared
> across whoever hits the API. Teams/players/tournaments/games are persisted to
> Postgres (Supabase) through a Bun API server; the live game itself runs
> offline-first in the browser (`localStorage`) and syncs back opportunistically
> — see [DEPLOYMENT.md](./DEPLOYMENT.md) for hosting it.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3 (`curl -fsSL https://bun.sh/install | bash`)
- A Postgres database — either a [Supabase](https://supabase.com) project, or
  Docker for a local throwaway one (`docker run -d -e POSTGRES_PASSWORD=devpass
  -e POSTGRES_DB=lca_dev -p 55432:5432 postgres:16-alpine`)

## Open the app

```bash
bun install                     # install workspace deps (first time only)
cp apps/server/.env.example apps/server/.env   # set DATABASE_URL, see below
bun run --filter server db:migrate             # create the tables (once)
bun run dev:server              # start the API on :4000
bun run dev:web                 # start the Next.js dev server on :3100
```

If your local Postgres isn't Supabase (e.g. the Docker one-liner above), set
`apps/server/.env`'s `DATABASE_URL` to
`postgres://postgres:devpass@localhost:55432/lca_dev`. See
`apps/server/.env.example` for the Supabase pooler URIs and
`apps/web/.env.example` for `NEXT_PUBLIC_API_URL` if the API isn't on
`localhost:4000`.

Then open **http://localhost:3100** in your browser. (The port is set to 3100 to
avoid the common 3000 clash; if 3100 is also taken, Next prints the actual URL in
the terminal. Change it in `apps/web/package.json` if you like.)

To use it on your phone, open the same URL with your computer's LAN IP
(e.g. `http://192.168.1.20:3100`) while both are on the same network.

Tip: use the **☾ / ☀ toggle** in the top-right to switch light/dark mode.

## Set up a team and run a game

Everything below happens in the app — no config files.

1. **Create a team.** The app opens on the **Teams** page. Enter a name, pick a
   division (**Mixed** enforces gender ratios; Open/Women don't), and hit Create.
2. **Add players.** Open the team. For each player set: **name**, optional
   **nickname** (what's shown on the sideline — must be unique on the roster),
   **MMP/WMP** (gender match, used for ratios in Mixed), **role** (Handler / Cutter
   / Both), and optional jersey number. Add at least **7** players (for Mixed, aim
   for **≥ 4 of each** gender so every ABBA point can be filled).
3. **Create a tournament.** In the team's **Tournaments** section, add one with a
   name and date.
4. **Check players in.** Open the tournament and tick the box for each player who's
   present. Toggle **Injured** for anyone hurt (they're locked out of lines).
5. **Start a game.** With ≥ 7 checked in, tap **New game** and set the opponent,
   game cap (13 or 15), timeouts per half, starting **O/D**, and — in Mixed — which
   gender is the majority on the first point. **Create & start** drops you straight
   into the live caller.
6. **Call lines.** Pick the required MMP/WMP (the counter and ratio enforce it),
   tap **Confirm line**, then **We scored / They scored** to advance the point. Use
   **Injury** for a forced hot-sub, plus **Halftime**, **Timeout**, **Undo**, and
   **End game**. Saved lines/pods, live points-played, and the ABBA gender cycle
   (`M2 · W1 · W2 · M1 …`) are shown to guide the call.
7. **Get around.** Back links walk the hierarchy **Game → Tournament → Team →
   Teams**, and the header lists any in-progress games for quick switching.

## Project layout (Bun workspaces)

```
packages/
  game-rules/   @shared/game-rules — pure, unit-tested rules engine (ABBA, O/D,
                halftime, validation, live-state derivation). Runs on client + server.
apps/
  web/          Next.js + TypeScript (App Router, Tailwind). Calls apps/server for
                setup data (teams/players/tournaments/saved lines/game creation);
                the live game itself runs offline in localStorage and syncs back.
  server/       Bun + TypeScript API. Drizzle ORM over Postgres (Supabase in
                production). Owns setup data; durably stores the live game via one
                coarse PUT /games/:id/sync per commit (see src/db/queries.ts).
```

## Dev commands

```bash
bun install                        # wire up the workspace + deps
bun test                           # run the game-rules test suite
bun run dev:web                    # web app → http://localhost:3100
bun run dev:server                 # API server → http://localhost:4000
bun run typecheck                  # typecheck every workspace
bun run --filter server db:generate  # generate a migration after a schema change
bun run --filter server db:migrate   # apply migrations (see apps/server/.env.example)
bun run --filter server db:studio    # Drizzle Studio, a GUI over the DB
```

## Where things live

- **Rules (shared, pure):** `packages/game-rules/src` — `rules.ts`, `state.ts`
  (live-game engine), `validation.ts`, `types.ts`.
- **API server:** `apps/server/src` — `db/schema.ts` (Drizzle tables),
  `db/queries.ts` (data access, incl. the tournament-roster→game-roster cascade
  and the live-game sync), `routes.ts`, `index.ts`.
- **API client (web):** `apps/web/lib/api/client.ts` and the API-backed
  `apps/web/lib/storage/{teams,tournaments,savedLines,games}.ts`.
- **Local live-game cache:** `apps/web/lib/storage/gameLog.ts` (point log, meta,
  roster snapshot) + `outbox.ts` (best-effort sync to the server).
- **Live-game hook:** `apps/web/lib/game/useLiveGame.ts` (binds storage ↔ rules ↔ UI).
- **Pages & components:** `apps/web/app` (routes) and `apps/web/components`
  (`setup/` for teams/tournaments, `game/` for the live caller).

## Deploying

See [DEPLOYMENT.md](./DEPLOYMENT.md) — Supabase setup, Dockerfiles for both
apps, a `docker-compose.yml` for local testing, and CI.
