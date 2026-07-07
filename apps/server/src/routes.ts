// Route table. Resource-oriented, mirrors §9 of the design doc — except the live
// game, which uses one coarse-grained `PUT /games/:id/sync` instead of one
// endpoint per event type (see queries.syncGame for why: the client already runs
// @shared/game-rules locally and is authoritative for the log, so the server's
// job is durable storage, not re-validating a state machine it doesn't own).

import { z } from "zod";
import { newId } from "./id";
import { HttpError, json, notFound, parseBody } from "./http";
import * as q from "./db/queries";

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
      z.object({ name: z.string().min(1), division, startDate: z.string() }),
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

  // ── Tournament check-in roster ─────────────────────────────────────────────
  route("GET", "/tournaments/:id/roster", async (_req, { id }) =>
    json(await q.listTournamentRoster(id!)),
  ),
  route("PUT", "/tournaments/:id/roster/:playerId", async (req, { id, playerId }) => {
    const body = await parseBody(req, z.object({ present: z.boolean() }));
    const tournament = await q.getTournament(id!);
    if (!tournament) return notFound();
    await q.setTournamentPresence(id!, playerId!, body.present);
    await q.syncTournamentGameRosters(tournament.teamId, id!);
    return json({ ok: true });
  }),
  route(
    "PATCH",
    "/tournaments/:id/roster/:playerId",
    async (req, { id, playerId }) => {
      const body = await parseBody(req, z.object({ injured: z.boolean() }));
      await q.setTournamentInjured(id!, playerId!, body.injured);
      return json({ ok: true });
    },
  ),

  // ── Saved lines ────────────────────────────────────────────────────────────
  route("GET", "/teams/:id/saved-lines", async (_req, { id }) =>
    json(await q.listSavedLines(id!)),
  ),
  route("POST", "/teams/:id/saved-lines", async (req, { id }) => {
    const body = await parseBody(
      req,
      z.object({ name: z.string().min(1), playerIds: z.array(z.string()).min(1) }),
    );
    return json(
      await q.createSavedLine({ id: newId(), teamId: id!, ...body }),
      201,
    );
  }),
  route("PATCH", "/saved-lines/:id", async (req, { id }) => {
    const body = await parseBody(
      req,
      z.object({ name: z.string().optional(), playerIds: z.array(z.string()).optional() }),
    );
    const line = await q.updateSavedLine(id!, body);
    return line ? json(line) : notFound();
  }),
  route("POST", "/saved-lines/:id/use", async (_req, { id }) => {
    const line = await q.incrementSavedLineUsage(id!);
    return line ? json(line) : notFound();
  }),
  route("DELETE", "/saved-lines/:id", async (_req, { id }) => {
    await q.deleteSavedLine(id!);
    return json({ ok: true });
  }),

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
        startingOD: od,
        startingGenderRatio: genderRatio.optional(),
        roster: z.array(rosterEntry),
      }),
    );
    return json(await q.createGame({ id: newId(), ...body }), 201);
  }),
  route("GET", "/games/:id/full", async (_req, { id }) => {
    const full = await q.getGameFull(id!);
    return full ? json(full) : notFound();
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
      // 409: the body still carries the server's current full state so the
      // client can reconcile without a second round trip (see resyncNow).
      return result.reason === "not_found" ? notFound() : json(result.full, 409);
    }
    return json(result.full);
  }),
  route("DELETE", "/games/:id", async (_req, { id }) => {
    await q.deleteGame(id!);
    return json({ ok: true });
  }),
];
