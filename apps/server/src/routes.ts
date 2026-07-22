// Route table. Resource-oriented, mirrors §9 of the design doc — except the live
// game, which uses one coarse-grained `PUT /games/:id/sync` instead of one
// endpoint per event type (see queries.syncGame for why: the client already runs
// @shared/game-rules locally and is authoritative for the log, so the server's
// job is durable storage, not re-validating a state machine it doesn't own).

import { z } from "zod";
import { newId } from "./id";
import { corsHeaders, HttpError, json, notFound, parseBody } from "./http";
import * as q from "./db/queries";
import { broadcast, savedLinesChannel, subscribe, unsubscribe } from "./sse";
import { verifyAuthPhone } from "./auth";

export type Handler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

export interface Route {
  method: string;
  path: string;
  handler: Handler;
}

/** Match a "/games/:id/points/:pid" pattern; returns captured params or null. */
export function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const pSeg = pattern.split("/").filter(Boolean);
  const uSeg = pathname.split("/").filter(Boolean);
  if (pSeg.length !== uSeg.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pSeg.length; i++) {
    const p = pSeg[i]!;
    const u = uSeg[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(u);
    else if (p !== u) return null;
  }
  return params;
}

const division = z.enum(["mixed", "open", "women"]);
const role = z.enum(["handler", "cutter", "both"]);
const genderMatch = z.enum(["MMP", "WMP"]);
const odPreference = z.enum(["O", "D", "both"]);
const od = z.enum(["O", "D"]);
const genderRatio = z.enum(["4MMP_3WMP", "4WMP_3MMP"]);
// null = a "time cap" game (no score cap; only a manual End game completes it).
const gameCap = z.union([z.literal(13), z.literal(15), z.null()]);
const lineColor = z.enum(["red", "green", "blue", "yellow", "black", "purple"]);
const lineTags = z.array(z.string().trim().min(1).max(24)).max(15);
const fieldSide = z.enum(["left", "right"]);
const teamColor = z.enum(["light", "dark"]);

const rosterEntry = z.object({
  playerId: z.string(),
  name: z.string(),
  nickname: z.string().optional(),
  genderMatch,
  role,
  odPreference: odPreference.optional(),
  jerseyNumber: z.number().optional(),
  injured: z.boolean(),
  active: z.boolean().optional(),
});

const pointSchema = z.object({
  id: z.string(),
  gameId: z.string(),
  pointNumber: z.number(),
  od,
  genderRatio: genderRatio.optional(),
  lineup: z.array(z.string()),
  substitutions: z
    .array(
      z.object({
        injuredPlayerId: z.string(),
        replacementPlayerId: z.string(),
      }),
    )
    .optional(),
  result: z.enum(["us", "them"]).optional(),
  isFirstAfterHalftime: z.boolean(),
});

const gameMetaSchema = z.object({
  halftimeReached: z.boolean(),
  ourTimeoutsRemaining: z.number(),
  theirTimeoutsRemaining: z.number(),
  endedManually: z.boolean(),
});

// Loose E.164 check for a manager phone submitted via the API — the JWT's own
// `phone` claim is normalized separately in auth.ts; this is for phone
// numbers a caller types into the "add manager" UI.
const phoneNumber = z.string().regex(/^\+[1-9]\d{6,14}$/, "Must be E.164, e.g. +14155550123");

function wrap(handler: Handler): Handler {
  return async (req, params) => {
    try {
      return await handler(req, params);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "internal_error" }, 500);
    }
  };
}

const route = (method: string, path: string, handler: Handler): Route => ({
  method,
  path,
  handler: wrap(handler),
});

/** Resolves which team a request concerns, for the authorization check below.
 *  Returns `null` if the request doesn't resolve to a real team (→ 403,
 *  same as "not a manager" — every id here is a client-generated UUID, so
 *  there's no meaningful distinction to leak between "doesn't exist" and
 *  "not yours"). Receives an already-`.clone()`d request so routes that need
 *  to inspect the body (POST /games) can safely do so without consuming the
 *  body the real handler still needs to parse. */
type TeamResolver = (
  req: Request,
  params: Record<string, string>,
) => Promise<string | null>;

type AuthedHandler = (
  req: Request,
  params: Record<string, string>,
  phone: string,
) => Response | Promise<Response>;

/** Verifies the caller's Supabase session, then (unless `resolveTeamId` is
 *  `null`) checks they're a manager of whichever team the request concerns
 *  before calling `handler`. Pass `null` only for routes with no existing
 *  team to check yet (creating a team) — every other route must resolve one. */
function authedRoute(
  method: string,
  path: string,
  resolveTeamId: TeamResolver | null,
  handler: AuthedHandler,
): Route {
  return route(method, path, async (req, params) => {
    const phone = await verifyAuthPhone(req);
    if (resolveTeamId) {
      const teamId = await resolveTeamId(req.clone() as Request, params);
      if (!teamId || !(await q.isTeamManager(teamId, phone))) {
        throw new HttpError(403, "Not a manager of this team");
      }
    }
    return handler(req, params, phone);
  });
}

const teamIdParam: TeamResolver = async (_req, params) => params.id ?? null;
const tournamentTeamId: TeamResolver = async (_req, { id }) =>
  (await q.getTournament(id!))?.teamId ?? null;
const gameTeamId: TeamResolver = async (_req, { id }) => q.getGameTeamId(id!);

/** A bare SSE stream over one sse.ts channel — used for both a game's own
 *  conflict/update notifications and (separately) a team's saved-lines
 *  updates. Just relays whatever broadcast() sends; callers never need to
 *  inspect the stream itself, only subscribe/unsubscribe to the channel. */
function sseStream(channel: string): Response {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval>;
  let controllerRef: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      subscribe(channel, controller);
      controller.enqueue(encoder.encode(": connected\n\n"));
      // Keep the connection alive through idle proxies/load balancers.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe(channel, controllerRef);
    },
  });
  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

export const routes: Route[] = [
  // ── Me ─────────────────────────────────────────────────────────────────────
  // The display name for the caller's own verified phone identity (§4.0) —
  // called once, right after sign-up verifies the OTP (see
  // apps/web/components/auth-gate.tsx). No team check: this is about the
  // caller's own identity, not any team's data.
  authedRoute("PUT", "/me/profile", null, async (req, _params, phone) => {
    const body = await parseBody(
      req,
      z.object({ firstName: z.string().min(1), lastName: z.string().min(1) }),
    );
    const user = await q.upsertUser({ phone, ...body });
    return json(user);
  }),

  // ── Teams ──────────────────────────────────────────────────────────────────
  // Not a single-resource check — the teams a phone can see are exactly the
  // ones it manages, so this is a filtered list, not a per-team auth check.
  authedRoute("GET", "/teams", null, async (_req, _params, phone) =>
    json(await q.listTeamsForManager(phone)),
  ),
  authedRoute("POST", "/teams", null, async (req, _params, phone) => {
    const body = await parseBody(req, z.object({ name: z.string().min(1), division }));
    const team = await q.createTeam({ id: newId(), ...body });
    await q.addTeamManager(team.id, phone); // creator becomes the first manager
    return json(team, 201);
  }),
  authedRoute("GET", "/teams/:id", teamIdParam, async (_req, { id }) => {
    const team = await q.getTeam(id!);
    return team ? json(team) : notFound();
  }),
  authedRoute("DELETE", "/teams/:id", teamIdParam, async (_req, { id }) => {
    await q.deleteTeam(id!);
    return json({ ok: true });
  }),

  // ── Team managers ────────────────────────────────────────────────────────
  authedRoute("GET", "/teams/:id/managers", teamIdParam, async (_req, { id }) =>
    json(await q.listTeamManagers(id!)),
  ),
  authedRoute("POST", "/teams/:id/managers", teamIdParam, async (req, { id }) => {
    const body = await parseBody(req, z.object({ phone: phoneNumber }));
    await q.addTeamManager(id!, body.phone);
    return json(await q.listTeamManagers(id!), 201);
  }),
  authedRoute(
    "DELETE",
    "/teams/:id/managers/:phone",
    teamIdParam,
    async (_req, { id, phone }) => {
      const result = await q.removeTeamManager(id!, decodeURIComponent(phone!));
      if (!result.ok) {
        if (result.reason === "not_found") return notFound();
        return json({ error: "last_manager", message: "A team needs at least one manager" }, 400);
      }
      return json(await q.listTeamManagers(id!));
    },
  ),

  // ── Players ────────────────────────────────────────────────────────────────
  authedRoute("GET", "/teams/:id/players", teamIdParam, async (_req, { id }) =>
    json(await q.listPlayers(id!)),
  ),
  authedRoute("POST", "/teams/:id/players", teamIdParam, async (req, { id }) => {
    const body = await parseBody(
      req,
      z.object({
        name: z.string().min(1),
        nickname: z.string().optional(),
        genderMatch,
        role,
        odPreference: odPreference.optional(),
        jerseyNumber: z.number().optional(),
      }),
    );
    return json(await q.createPlayer(newId(), id!, body), 201);
  }),
  authedRoute(
    "PATCH",
    "/players/:id",
    async (_req, { id }) => q.getPlayerTeamId(id!),
    async (req, { id }) => {
      const body = await parseBody(
        req,
        z.object({
          name: z.string().min(1).optional(),
          nickname: z.string().optional(),
          genderMatch: genderMatch.optional(),
          role: role.optional(),
          odPreference: odPreference.optional(),
          jerseyNumber: z.number().optional(),
        }),
      );
      const player = await q.updatePlayer(id!, body);
      return player ? json(player) : notFound();
    },
  ),
  authedRoute(
    "DELETE",
    "/players/:id",
    async (_req, { id }) => q.getPlayerTeamId(id!),
    async (_req, { id }) => {
      await q.deletePlayer(id!);
      return json({ ok: true });
    },
  ),

  // ── Tournaments ────────────────────────────────────────────────────────────
  authedRoute("GET", "/teams/:id/tournaments", teamIdParam, async (_req, { id }) =>
    json(await q.listTournaments(id!)),
  ),
  authedRoute("POST", "/teams/:id/tournaments", teamIdParam, async (req, { id }) => {
    const body = await parseBody(
      req,
      z
        .object({
          name: z.string().min(1),
          division,
          startDate: z.string(),
          endDate: z.string().optional(),
        })
        .refine((b) => !b.endDate || b.endDate >= b.startDate, {
          message: "endDate must be on or after startDate",
          path: ["endDate"],
        }),
    );
    return json(
      await q.createTournament({ id: newId(), teamId: id!, ...body }),
      201,
    );
  }),
  authedRoute("GET", "/tournaments/:id", tournamentTeamId, async (_req, { id }) => {
    const t = await q.getTournament(id!);
    return t ? json(t) : notFound();
  }),
  authedRoute("DELETE", "/tournaments/:id", tournamentTeamId, async (_req, { id }) => {
    await q.deleteTournament(id!);
    return json({ ok: true });
  }),

  // ── Tournament check-in roster ─────────────────────────────────────────────
  authedRoute("GET", "/tournaments/:id/roster", tournamentTeamId, async (_req, { id }) =>
    json(await q.listTournamentRoster(id!)),
  ),
  // Batched check-in: the client buffers present/injured taps in localStorage
  // and flushes them here periodically (see apps/web's tournament-detail.tsx)
  // instead of one request per tap. Applies all changes then re-syncs every
  // game under the tournament once, and returns the resulting roster — the
  // client just adopts whatever comes back rather than reconciling conflicts
  // itself.
  authedRoute("PUT", "/tournaments/:id/roster", tournamentTeamId, async (req, { id }) => {
    const body = await parseBody(
      req,
      z.object({
        changes: z.array(
          z.object({
            playerId: z.string(),
            present: z.boolean(),
            injured: z.boolean(),
          }),
        ),
      }),
    );
    const tournament = await q.getTournament(id!);
    if (!tournament) return notFound();
    await q.batchUpdateTournamentRoster(id!, body.changes);
    await q.syncTournamentGameRosters(tournament.teamId, id!);
    return json(await q.listTournamentRoster(id!));
  }),

  // ── Saved lines ────────────────────────────────────────────────────────────
  // Tournament-scoped (§4.3) — each tournament has its own independent pool of
  // lines/pods, since a team often reuses the same roster across several
  // tournaments with different needs each time.
  authedRoute(
    "GET",
    "/tournaments/:id/saved-lines",
    tournamentTeamId,
    async (_req, { id }) => json(await q.listSavedLines(id!)),
  ),
  authedRoute(
    "POST",
    "/tournaments/:id/saved-lines",
    tournamentTeamId,
    async (req, { id }) => {
      const body = await parseBody(
        req,
        z.object({
          name: z.string().min(1),
          playerIds: z.array(z.string()).min(1),
          color: lineColor.nullable().optional(),
          side: odPreference.nullable().optional(),
          tags: lineTags.optional(),
        }),
      );
      const line = await q.createSavedLine({ id: newId(), tournamentId: id!, ...body });
      broadcast(savedLinesChannel(id!), { type: "updated" });
      return json(line, 201);
    },
  ),
  authedRoute(
    "PATCH",
    "/saved-lines/:id",
    async (_req, { id }) => q.getSavedLineTeamId(id!),
    async (req, { id }) => {
      const body = await parseBody(
        req,
        z.object({
          name: z.string().optional(),
          playerIds: z.array(z.string()).optional(),
          color: lineColor.nullable().optional(),
          side: odPreference.nullable().optional(),
          hidden: z.boolean().optional(),
          tags: lineTags.optional(),
        }),
      );
      const line = await q.updateSavedLine(id!, body);
      if (!line) return notFound();
      broadcast(savedLinesChannel(line.tournamentId), { type: "updated" });
      return json(line);
    },
  ),
  authedRoute(
    "POST",
    "/saved-lines/:id/use",
    async (_req, { id }) => q.getSavedLineTeamId(id!),
    async (_req, { id }) => {
      const line = await q.incrementSavedLineUsage(id!);
      if (!line) return notFound();
      broadcast(savedLinesChannel(line.tournamentId), { type: "updated" });
      return json(line);
    },
  ),
  authedRoute(
    "DELETE",
    "/saved-lines/:id",
    async (_req, { id }) => q.getSavedLineTeamId(id!),
    async (_req, { id }) => {
      const tournamentId = await q.deleteSavedLine(id!);
      if (tournamentId) broadcast(savedLinesChannel(tournamentId), { type: "updated" });
      return json({ ok: true });
    },
  ),
  // SSE stream of saved-lines updates for one tournament (see sse.ts) —
  // entirely separate from any game's own conflict/version notifications, so
  // an in-progress live game never treats a pod being saved/edited elsewhere
  // as its own state going stale. Auth via ?token= query param (see auth.ts)
  // — native EventSource can't set headers.
  authedRoute(
    "GET",
    "/tournaments/:id/saved-lines/events",
    tournamentTeamId,
    async (_req, { id }) => sseStream(savedLinesChannel(id!)),
  ),

  // ── Games ──────────────────────────────────────────────────────────────────
  authedRoute("GET", "/teams/:id/games", teamIdParam, async (_req, { id }) =>
    json(await q.listTeamGames(id!)),
  ),
  authedRoute("GET", "/tournaments/:id/games", tournamentTeamId, async (_req, { id }) =>
    json(await q.listTournamentGames(id!)),
  ),
  authedRoute("GET", "/tournaments/:id/stats", tournamentTeamId, async (_req, { id }) =>
    json(await q.getTournamentStats(id!)),
  ),
  authedRoute(
    "POST",
    "/games",
    async (req) => {
      const body: unknown = await req.json().catch(() => null);
      const teamId = (body as { teamId?: unknown } | null)?.teamId;
      return typeof teamId === "string" ? teamId : null;
    },
    async (req) => {
      const body = await parseBody(
        req,
        z.object({
          teamId: z.string(),
          tournamentId: z.string().optional(),
          opponentName: z.string().min(1),
          gameCap,
          halfScore: z.number().nullable(),
          timeoutsPerHalf: z.number(),
          startingOD: od.optional(),
          startingGenderRatio: genderRatio.optional(),
          fieldNumber: z.string().optional(),
          gameDate: z.string().optional(),
          startTime: z.string().optional(),
          opposingCoachName: z.string().optional(),
          roster: z.array(rosterEntry),
        }),
      );
      return json(await q.createGame({ id: newId(), ...body }), 201);
    },
  ),
  authedRoute("POST", "/games/:id/resolve-flip", gameTeamId, async (req, { id }) => {
    const body = await parseBody(
      req,
      z.object({
        fieldSide,
        teamColor,
        startingOD: od,
        startingGenderRatio: genderRatio.optional(),
      }),
    );
    const game = await q.resolveFlip(id!, body);
    broadcast(id!, { type: "updated", version: game.version });
    return json(game);
  }),
  authedRoute("POST", "/games/:id/undo-flip", gameTeamId, async (_req, { id }) => {
    const game = await q.undoFlip(id!);
    broadcast(id!, { type: "updated", version: game.version });
    return json(game);
  }),
  authedRoute("GET", "/games/:id/full", gameTeamId, async (_req, { id }) => {
    const full = await q.getGameFull(id!);
    return full ? json(full) : notFound();
  }),
  authedRoute("PATCH", "/games/:id/metadata", gameTeamId, async (req, { id }) => {
    const body = await parseBody(
      req,
      z.object({
        opponentName: z.string().min(1).optional(),
        fieldNumber: z.string().nullable().optional(),
        gameDate: z.string().nullable().optional(),
        startTime: z.string().nullable().optional(),
        opposingCoachName: z.string().nullable().optional(),
      }),
    );
    const game = await q.updateGameMetadata(id!, body);
    if (!game) return notFound();
    broadcast(id!, { type: "updated", version: game.version });
    return json(game);
  }),
  authedRoute("PUT", "/games/:id/sync", gameTeamId, async (req, { id }) => {
    const body = await parseBody(
      req,
      z.object({
        version: z.number(),
        meta: gameMetaSchema,
        points: z.array(pointSchema),
        roster: z.array(rosterEntry),
      }),
    );
    const result = await q.syncGame(id!, body);
    if (!result.ok) {
      if (result.reason === "not_found") return notFound();
      // 409: the body still carries the server's current full state so the
      // client can reconcile without a second round trip (see resyncNow).
      // Also push it over SSE so any other connected client (including a
      // viewer who hasn't tried to write) learns about the conflict right
      // away instead of only on its own next failed sync.
      broadcast(id!, {
        type: "conflict",
        version: result.full.game.version,
        rejectedVersion: body.version,
      });
      return json(result.full, 409);
    }
    broadcast(id!, { type: "updated", version: result.full.game.version });
    return json(result.full);
  }),
  // SSE stream of conflict/update notifications for one game (see sse.ts) —
  // lets a connected client find out its local state is stale in real time,
  // rather than only discovering it via a rejected write. Auth via ?token=
  // query param (see auth.ts) — native EventSource can't set headers.
  authedRoute("GET", "/games/:id/events", gameTeamId, async (_req, { id }) => sseStream(id!)),
  authedRoute("DELETE", "/games/:id", gameTeamId, async (_req, { id }) => {
    await q.deleteGame(id!);
    return json({ ok: true });
  }),
];
