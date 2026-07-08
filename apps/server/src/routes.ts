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
const gameCap = z.union([z.literal(13), z.literal(15)]);
const lineColor = z.enum(["red", "green", "blue", "yellow", "black", "purple"]);
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
  // ── Teams ──────────────────────────────────────────────────────────────────
  route("GET", "/teams", async () => json(await q.listTeams())),
  route("POST", "/teams", async (req) => {
    const body = await parseBody(req, z.object({ name: z.string().min(1), division }));
    return json(await q.createTeam({ id: newId(), ...body }), 201);
  }),
  route("GET", "/teams/:id", async (_req, { id }) => {
    const team = await q.getTeam(id!);
    return team ? json(team) : notFound();
  }),
  route("DELETE", "/teams/:id", async (_req, { id }) => {
    await q.deleteTeam(id!);
    return json({ ok: true });
  }),

  // ── Players ────────────────────────────────────────────────────────────────
  route("GET", "/teams/:id/players", async (_req, { id }) =>
    json(await q.listPlayers(id!)),
  ),
  route("POST", "/teams/:id/players", async (req, { id }) => {
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
  route("PATCH", "/players/:id", async (req, { id }) => {
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
  }),
  route("DELETE", "/players/:id", async (_req, { id }) => {
    await q.deletePlayer(id!);
    return json({ ok: true });
  }),

  // ── Tournaments ────────────────────────────────────────────────────────────
  route("GET", "/teams/:id/tournaments", async (_req, { id }) =>
    json(await q.listTournaments(id!)),
  ),
  route("POST", "/teams/:id/tournaments", async (req, { id }) => {
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
  route("GET", "/tournaments/:id", async (_req, { id }) => {
    const t = await q.getTournament(id!);
    return t ? json(t) : notFound();
  }),
  route("DELETE", "/tournaments/:id", async (_req, { id }) => {
    await q.deleteTournament(id!);
    return json({ ok: true });
  }),

  // ── Tournament check-in roster ─────────────────────────────────────────────
  route("GET", "/tournaments/:id/roster", async (_req, { id }) =>
    json(await q.listTournamentRoster(id!)),
  ),
  // Batched check-in: the client buffers present/injured taps in localStorage
  // and flushes them here periodically (see apps/web's tournament-detail.tsx)
  // instead of one request per tap. Applies all changes then re-syncs every
  // game under the tournament once, and returns the resulting roster — the
  // client just adopts whatever comes back rather than reconciling conflicts
  // itself.
  route("PUT", "/tournaments/:id/roster", async (req, { id }) => {
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
  route("GET", "/teams/:id/saved-lines", async (_req, { id }) =>
    json(await q.listSavedLines(id!)),
  ),
  route("POST", "/teams/:id/saved-lines", async (req, { id }) => {
    const body = await parseBody(
      req,
      z.object({
        name: z.string().min(1),
        playerIds: z.array(z.string()).min(1),
        color: lineColor.nullable().optional(),
        side: odPreference.nullable().optional(),
      }),
    );
    const line = await q.createSavedLine({ id: newId(), teamId: id!, ...body });
    broadcast(savedLinesChannel(id!), { type: "updated" });
    return json(line, 201);
  }),
  route("PATCH", "/saved-lines/:id", async (req, { id }) => {
    const body = await parseBody(
      req,
      z.object({
        name: z.string().optional(),
        playerIds: z.array(z.string()).optional(),
        color: lineColor.nullable().optional(),
        side: odPreference.nullable().optional(),
      }),
    );
    const line = await q.updateSavedLine(id!, body);
    if (!line) return notFound();
    broadcast(savedLinesChannel(line.teamId), { type: "updated" });
    return json(line);
  }),
  route("POST", "/saved-lines/:id/use", async (_req, { id }) => {
    const line = await q.incrementSavedLineUsage(id!);
    if (!line) return notFound();
    broadcast(savedLinesChannel(line.teamId), { type: "updated" });
    return json(line);
  }),
  route("DELETE", "/saved-lines/:id", async (_req, { id }) => {
    const teamId = await q.deleteSavedLine(id!);
    if (teamId) broadcast(savedLinesChannel(teamId), { type: "updated" });
    return json({ ok: true });
  }),
  // SSE stream of saved-lines updates for one team (see sse.ts) — entirely
  // separate from any game's own conflict/version notifications, so an
  // in-progress live game never treats a pod being saved/edited elsewhere as
  // its own state going stale.
  route("GET", "/teams/:id/saved-lines/events", async (_req, { id }) =>
    sseStream(savedLinesChannel(id!)),
  ),

  // ── Games ──────────────────────────────────────────────────────────────────
  route("GET", "/teams/:id/games", async (_req, { id }) =>
    json(await q.listTeamGames(id!)),
  ),
  route("GET", "/tournaments/:id/games", async (_req, { id }) =>
    json(await q.listTournamentGames(id!)),
  ),
  route("POST", "/games", async (req) => {
    const body = await parseBody(
      req,
      z.object({
        teamId: z.string(),
        tournamentId: z.string().optional(),
        opponentName: z.string().min(1),
        gameCap,
        halfScore: z.number(),
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
  }),
  route("POST", "/games/:id/resolve-flip", async (req, { id }) => {
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
  route("POST", "/games/:id/undo-flip", async (_req, { id }) => {
    const game = await q.undoFlip(id!);
    broadcast(id!, { type: "updated", version: game.version });
    return json(game);
  }),
  route("GET", "/games/:id/full", async (_req, { id }) => {
    const full = await q.getGameFull(id!);
    return full ? json(full) : notFound();
  }),
  route("PATCH", "/games/:id/metadata", async (req, { id }) => {
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
  route("PUT", "/games/:id/sync", async (req, { id }) => {
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
  // rather than only discovering it via a rejected write.
  route("GET", "/games/:id/events", async (_req, { id }) => sseStream(id!)),
  route("DELETE", "/games/:id", async (_req, { id }) => {
    await q.deleteGame(id!);
    return json({ ok: true });
  }),
];
