// Data-access layer. Thin wrappers around Drizzle — no business rules live here
// (those stay in @shared/game-rules, run client-side before a sync ever reaches
// this file). IDs are always client-supplied so every insert can double as an
// idempotent upsert.

import { and, eq } from "drizzle-orm";
import type {
  Division,
  Game,
  GameCap,
  GameMeta,
  GameStatus,
  GenderMatch,
  GenderRatio,
  OD,
  ODPreference,
  Player,
  Point,
  Role,
  SavedLine,
  Substitution,
  Team,
  Tournament,
} from "@shared/game-rules";
import { db } from "./client";
import {
  gameRoster,
  games,
  players,
  points,
  savedLines,
  teams,
  tournamentRoster,
  tournaments,
} from "./schema";

// ── Teams ──────────────────────────────────────────────────────────────────────

export async function listTeams(): Promise<Team[]> {
  const rows = await db.select().from(teams);
  return rows.map(toTeam);
}

export async function getTeam(id: string): Promise<Team | null> {
  const [row] = await db.select().from(teams).where(eq(teams.id, id));
  return row ? toTeam(row) : null;
}

export async function createTeam(input: {
  id: string;
  name: string;
  division: Division;
}): Promise<Team> {
  const [row] = await db
    .insert(teams)
    .values({ id: input.id, name: input.name, division: input.division })
    .returning();
  return toTeam(row!);
}

function toTeam(row: typeof teams.$inferSelect): Team {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    division: row.division as Division,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Players ──────────────────────────────────────────────────────────────────

export interface PlayerInput {
  name: string;
  nickname?: string;
  genderMatch: GenderMatch;
  role: Role;
  odPreference?: ODPreference;
  jerseyNumber?: number;
}

export async function listPlayers(teamId: string): Promise<Player[]> {
  const rows = await db.select().from(players).where(eq(players.teamId, teamId));
  return rows.map(toPlayer);
}

export async function createPlayer(
  id: string,
  teamId: string,
  input: PlayerInput,
): Promise<Player> {
  const [row] = await db
    .insert(players)
    .values({
      id,
      teamId,
      name: input.name,
      nickname: input.nickname,
      genderMatch: input.genderMatch,
      role: input.role,
      odPreference: input.odPreference,
      jerseyNumber: input.jerseyNumber,
    })
    .returning();
  return toPlayer(row!);
}

export async function updatePlayer(
  id: string,
  patch: Partial<PlayerInput>,
): Promise<Player | null> {
  const [row] = await db
    .update(players)
    .set(patch)
    .where(eq(players.id, id))
    .returning();
  return row ? toPlayer(row) : null;
}

export async function deletePlayer(id: string): Promise<void> {
  await db.delete(players).where(eq(players.id, id));
}

function toPlayer(row: typeof players.$inferSelect): Player {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    nickname: row.nickname ?? undefined,
    genderMatch: row.genderMatch as GenderMatch,
    role: row.role as Role,
    odPreference: (row.odPreference as ODPreference) ?? undefined,
    jerseyNumber: row.jerseyNumber ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Tournaments ──────────────────────────────────────────────────────────────

export async function listTournaments(teamId: string): Promise<Tournament[]> {
  const rows = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.teamId, teamId));
  return rows.map(toTournament);
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const [row] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, id));
  return row ? toTournament(row) : null;
}

export async function createTournament(input: {
  id: string;
  teamId: string;
  name: string;
  division: Division;
  startDate: string;
}): Promise<Tournament> {
  const [row] = await db
    .insert(tournaments)
    .values({
      id: input.id,
      teamId: input.teamId,
      name: input.name,
      division: input.division,
      startDate: input.startDate,
    })
    .returning();
  return toTournament(row!);
}

function toTournament(row: typeof tournaments.$inferSelect): Tournament {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    division: row.division as Division,
    startDate: row.startDate,
    endDate: row.endDate ?? undefined,
    started: row.started,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Tournament check-in roster ───────────────────────────────────────────────

export interface TournamentRosterEntry {
  playerId: string;
  injured: boolean;
}

export async function listTournamentRoster(
  tournamentId: string,
): Promise<TournamentRosterEntry[]> {
  const rows = await db
    .select()
    .from(tournamentRoster)
    .where(eq(tournamentRoster.tournamentId, tournamentId));
  return rows.map((r) => ({ playerId: r.playerId, injured: r.injured }));
}

export async function setTournamentPresence(
  tournamentId: string,
  playerId: string,
  present: boolean,
): Promise<void> {
  if (present) {
    await db
      .insert(tournamentRoster)
      .values({ id: `${tournamentId}:${playerId}`, tournamentId, playerId })
      .onConflictDoNothing({
        target: [tournamentRoster.tournamentId, tournamentRoster.playerId],
      });
  } else {
    await db
      .delete(tournamentRoster)
      .where(
        and(
          eq(tournamentRoster.tournamentId, tournamentId),
          eq(tournamentRoster.playerId, playerId),
        ),
      );
  }
}

export async function setTournamentInjured(
  tournamentId: string,
  playerId: string,
  injured: boolean,
): Promise<void> {
  await db
    .update(tournamentRoster)
    .set({ injured })
    .where(
      and(
        eq(tournamentRoster.tournamentId, tournamentId),
        eq(tournamentRoster.playerId, playerId),
      ),
    );
}

/**
 * Mirrors apps/web/lib/storage/games.ts's syncTournamentGameRosters: push the
 * current check-in roster onto every game under this tournament. Existing
 * roster rows are never deleted (line history must keep resolving names), only
 * marked inactive; newly checked-in players are inserted as active.
 */
export async function syncTournamentGameRosters(
  teamId: string,
  tournamentId: string,
): Promise<void> {
  const [teamPlayers, roster, tournamentGames] = await Promise.all([
    listPlayers(teamId),
    listTournamentRoster(tournamentId),
    db.select().from(games).where(eq(games.tournamentId, tournamentId)),
  ]);
  const playerById = new Map(teamPlayers.map((p) => [p.id, p]));
  const presentIds = new Set(roster.map((r) => r.playerId));
  const injuredByPlayerId = new Map(roster.map((r) => [r.playerId, r.injured]));

  for (const game of tournamentGames) {
    const existing = await db
      .select()
      .from(gameRoster)
      .where(eq(gameRoster.gameId, game.id));
    const existingIds = new Set(existing.map((e) => e.playerId));

    for (const entry of existing) {
      const player = playerById.get(entry.playerId);
      const active = presentIds.has(entry.playerId);
      await db
        .update(gameRoster)
        .set(
          player
            ? {
                active,
                name: player.name,
                nickname: player.nickname,
                genderMatch: player.genderMatch,
                role: player.role,
                odPreference: player.odPreference,
                jerseyNumber: player.jerseyNumber,
              }
            : { active },
        )
        .where(eq(gameRoster.id, entry.id));
    }

    const additions = teamPlayers.filter(
      (p) => presentIds.has(p.id) && !existingIds.has(p.id),
    );
    for (const p of additions) {
      await db.insert(gameRoster).values({
        id: `${game.id}:${p.id}`,
        gameId: game.id,
        playerId: p.id,
        name: p.name,
        nickname: p.nickname,
        genderMatch: p.genderMatch,
        role: p.role,
        odPreference: p.odPreference,
        jerseyNumber: p.jerseyNumber,
        injured: injuredByPlayerId.get(p.id) ?? false,
        active: true,
      });
    }
  }
}

// ── Saved lines / pods ───────────────────────────────────────────────────────

export async function listSavedLines(teamId: string): Promise<SavedLine[]> {
  const rows = await db
    .select()
    .from(savedLines)
    .where(eq(savedLines.teamId, teamId));
  return rows.map(toSavedLine);
}

export async function createSavedLine(input: {
  id: string;
  teamId: string;
  name: string;
  playerIds: string[];
}): Promise<SavedLine> {
  const [row] = await db
    .insert(savedLines)
    .values({
      id: input.id,
      teamId: input.teamId,
      name: input.name,
      playerIds: input.playerIds,
    })
    .returning();
  return toSavedLine(row!);
}

export async function updateSavedLine(
  id: string,
  patch: { name?: string; playerIds?: string[] },
): Promise<SavedLine | null> {
  const [row] = await db
    .update(savedLines)
    .set(patch)
    .where(eq(savedLines.id, id))
    .returning();
  return row ? toSavedLine(row) : null;
}

export async function incrementSavedLineUsage(
  id: string,
): Promise<SavedLine | null> {
  const [existing] = await db
    .select()
    .from(savedLines)
    .where(eq(savedLines.id, id));
  if (!existing) return null;
  const [row] = await db
    .update(savedLines)
    .set({ useCount: existing.useCount + 1 })
    .where(eq(savedLines.id, id))
    .returning();
  return row ? toSavedLine(row) : null;
}

export async function deleteSavedLine(id: string): Promise<void> {
  await db.delete(savedLines).where(eq(savedLines.id, id));
}

function toSavedLine(row: typeof savedLines.$inferSelect): SavedLine {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    playerIds: row.playerIds,
    useCount: row.useCount,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Games ────────────────────────────────────────────────────────────────────

export interface RosterSnapshotEntry {
  playerId: string;
  name: string;
  nickname?: string;
  genderMatch: GenderMatch;
  role: Role;
  odPreference?: ODPreference;
  jerseyNumber?: number;
  injured: boolean;
  active?: boolean;
}

export interface GameFull {
  game: Game;
  meta: GameMeta;
  roster: RosterSnapshotEntry[];
  points: Point[];
}

export interface CreateGameInput {
  id: string;
  teamId: string;
  tournamentId?: string;
  opponentName: string;
  gameCap: GameCap;
  halfScore: number;
  timeoutsPerHalf: number;
  startingOD: OD;
  startingGenderRatio?: GenderRatio;
  roster: RosterSnapshotEntry[];
}

export async function createGame(input: CreateGameInput): Promise<GameFull> {
  const [row] = await db
    .insert(games)
    .values({
      id: input.id,
      teamId: input.teamId,
      tournamentId: input.tournamentId,
      opponentName: input.opponentName,
      gameCap: input.gameCap,
      halfScore: input.halfScore,
      timeoutsPerHalf: input.timeoutsPerHalf,
      startingGenderRatio: input.startingGenderRatio,
      startingOD: input.startingOD,
      status: "in_progress",
      ourTimeoutsRemaining: input.timeoutsPerHalf,
      theirTimeoutsRemaining: input.timeoutsPerHalf,
    })
    .returning();

  if (input.roster.length > 0) {
    await db.insert(gameRoster).values(
      input.roster.map((p) => ({
        id: `${input.id}:${p.playerId}`,
        gameId: input.id,
        playerId: p.playerId,
        name: p.name,
        nickname: p.nickname,
        genderMatch: p.genderMatch,
        role: p.role,
        odPreference: p.odPreference,
        jerseyNumber: p.jerseyNumber,
        injured: p.injured,
        active: p.active ?? true,
      })),
    );
  }

  return {
    game: toGame(row!),
    meta: toMeta(row!),
    roster: input.roster,
    points: [],
  };
}

export async function listTeamGames(teamId: string): Promise<Game[]> {
  const rows = await db.select().from(games).where(eq(games.teamId, teamId));
  return rows.map(toGame);
}

export async function listTournamentGames(
  tournamentId: string,
): Promise<Game[]> {
  const rows = await db
    .select()
    .from(games)
    .where(eq(games.tournamentId, tournamentId));
  return rows.map(toGame);
}

export async function getGameFull(gameId: string): Promise<GameFull | null> {
  const [row] = await db.select().from(games).where(eq(games.id, gameId));
  if (!row) return null;
  const [rosterRows, pointRows] = await Promise.all([
    db.select().from(gameRoster).where(eq(gameRoster.gameId, gameId)),
    db
      .select()
      .from(points)
      .where(eq(points.gameId, gameId))
      .orderBy(points.pointNumber),
  ]);
  return {
    game: toGame(row),
    meta: toMeta(row),
    roster: rosterRows.map(toRosterEntry),
    points: pointRows.map(toPoint),
  };
}

export type SyncGameResult =
  | { ok: true; full: GameFull }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; full: GameFull };

/**
 * Idempotent full-state sync for one game: the client is authoritative for the
 * live game (it runs @shared/game-rules locally, offline-first), so the server
 * doesn't re-derive anything here — it just durably stores whatever the client
 * already computed. Points are fully replaced (delete + reinsert) since a game's
 * log is small (well under a hundred rows) and this sidesteps any partial-update
 * bugs around undo/edit-history rewriting earlier points.
 *
 * `input.version` guards against two devices syncing the same game concurrently:
 * the client must send the version it last saw, and the UPDATE below only
 * commits if that's still the current version, atomically bumping it on
 * success. A stale version returns a conflict (with the server's current full
 * state) instead of silently clobbering whatever the other device just wrote —
 * the client decides how to reconcile (see apps/web/lib/game/useLiveGame.ts's
 * resyncNow).
 */
export async function syncGame(
  gameId: string,
  input: {
    version: number;
    meta: GameMeta;
    points: Point[];
    roster: RosterSnapshotEntry[];
  },
): Promise<SyncGameResult> {
  const [existing] = await db.select().from(games).where(eq(games.id, gameId));
  if (!existing) return { ok: false, reason: "not_found" };

  // The WHERE clause re-checks the version atomically with the write, so two
  // concurrent syncs can't both pass a check done earlier in JS and both land:
  // only the first to commit bumps the version and returns a row.
  const [row] = await db
    .update(games)
    .set({
      halftimeReached: input.meta.halftimeReached,
      ourTimeoutsRemaining: input.meta.ourTimeoutsRemaining,
      theirTimeoutsRemaining: input.meta.theirTimeoutsRemaining,
      endedManually: input.meta.endedManually,
      status: input.meta.endedManually ? "completed" : existing.status,
      version: existing.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(games.id, gameId), eq(games.version, input.version)))
    .returning();

  if (!row) {
    const full = await getGameFull(gameId);
    return { ok: false, reason: "conflict", full: full! };
  }

  await db.delete(points).where(eq(points.gameId, gameId));
  if (input.points.length > 0) {
    await db.insert(points).values(
      input.points.map((p) => ({
        id: p.id,
        gameId,
        pointNumber: p.pointNumber,
        od: p.od,
        genderRatio: p.genderRatio,
        lineup: p.lineup,
        substitutions: p.substitutions as Substitution[] | undefined,
        result: p.result,
        isFirstAfterHalftime: p.isFirstAfterHalftime,
      })),
    );
  }

  for (const entry of input.roster) {
    await db
      .insert(gameRoster)
      .values({
        id: `${gameId}:${entry.playerId}`,
        gameId,
        playerId: entry.playerId,
        name: entry.name,
        nickname: entry.nickname,
        genderMatch: entry.genderMatch,
        role: entry.role,
        odPreference: entry.odPreference,
        jerseyNumber: entry.jerseyNumber,
        injured: entry.injured,
        active: entry.active ?? true,
      })
      .onConflictDoUpdate({
        target: [gameRoster.gameId, gameRoster.playerId],
        set: {
          name: entry.name,
          nickname: entry.nickname,
          genderMatch: entry.genderMatch,
          role: entry.role,
          odPreference: entry.odPreference,
          jerseyNumber: entry.jerseyNumber,
          injured: entry.injured,
          active: entry.active ?? true,
        },
      });
  }

  const full = await getGameFull(gameId).then((f) => f!);
  return { ok: true, full };
}

export async function deleteGame(gameId: string): Promise<void> {
  await db.delete(games).where(eq(games.id, gameId));
}

function toGame(row: typeof games.$inferSelect): Game {
  return {
    id: row.id,
    teamId: row.teamId,
    tournamentId: row.tournamentId ?? undefined,
    opponentName: row.opponentName,
    gameCap: row.gameCap as GameCap,
    halfScore: row.halfScore,
    timeoutsPerHalf: row.timeoutsPerHalf,
    startingGenderRatio: (row.startingGenderRatio as GenderRatio) ?? undefined,
    startingOD: row.startingOD as OD,
    status: row.status as GameStatus,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function toMeta(row: typeof games.$inferSelect): GameMeta {
  return {
    halftimeReached: row.halftimeReached,
    ourTimeoutsRemaining: row.ourTimeoutsRemaining,
    theirTimeoutsRemaining: row.theirTimeoutsRemaining,
    endedManually: row.endedManually,
  };
}

function toRosterEntry(
  row: typeof gameRoster.$inferSelect,
): RosterSnapshotEntry {
  return {
    playerId: row.playerId,
    name: row.name,
    nickname: row.nickname ?? undefined,
    genderMatch: row.genderMatch as GenderMatch,
    role: row.role as Role,
    odPreference: (row.odPreference as ODPreference) ?? undefined,
    jerseyNumber: row.jerseyNumber ?? undefined,
    injured: row.injured,
    active: row.active,
  };
}

function toPoint(row: typeof points.$inferSelect): Point {
  return {
    id: row.id,
    gameId: row.gameId,
    pointNumber: row.pointNumber,
    od: row.od as OD,
    genderRatio: (row.genderRatio as GenderRatio) ?? undefined,
    lineup: row.lineup,
    substitutions: row.substitutions ?? undefined,
    result: (row.result as Point["result"]) ?? undefined,
    isFirstAfterHalftime: row.isFirstAfterHalftime,
  };
}
