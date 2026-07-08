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
  LineColor,
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

export async function deleteTeam(id: string): Promise<void> {
  await db.delete(teams).where(eq(teams.id, id));
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

/**
 * Deleting a player also strips them from every saved line/pod on the team —
 * otherwise the pod silently keeps an unreplaceable, invisible slot for a
 * player who no longer exists. A pod that ends up with no players left is
 * removed rather than kept around empty. This is distinct from tournament
 * check-in: being marked absent/injured there never touches saved lines,
 * since that's a per-tournament availability flag, not a roster removal.
 */
export async function deletePlayer(id: string): Promise<void> {
  const [player] = await db.select().from(players).where(eq(players.id, id));
  await db.delete(players).where(eq(players.id, id));
  if (!player) return;

  const teamLines = await db
    .select()
    .from(savedLines)
    .where(eq(savedLines.teamId, player.teamId));
  for (const line of teamLines) {
    if (!line.playerIds.includes(id)) continue;
    const nextPlayerIds = line.playerIds.filter((pid) => pid !== id);
    if (nextPlayerIds.length === 0) {
      await db.delete(savedLines).where(eq(savedLines.id, line.id));
    } else {
      await db
        .update(savedLines)
        .set({ playerIds: nextPlayerIds })
        .where(eq(savedLines.id, line.id));
    }
  }
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
  endDate?: string;
}): Promise<Tournament> {
  const [row] = await db
    .insert(tournaments)
    .values({
      id: input.id,
      teamId: input.teamId,
      name: input.name,
      division: input.division,
      startDate: input.startDate,
      endDate: input.endDate,
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

export interface TournamentRosterChange {
  playerId: string;
  present: boolean;
  injured: boolean;
}

/**
 * Applies a batch of check-in changes in one call — the client buffers taps
 * locally (localStorage) and flushes periodically instead of one request per
 * checkbox, so this always carries each changed player's full desired state
 * (both fields) rather than a partial patch, which sidesteps any ambiguity
 * about what to do with a field the caller didn't mention.
 */
export async function batchUpdateTournamentRoster(
  tournamentId: string,
  changes: TournamentRosterChange[],
): Promise<void> {
  for (const c of changes) {
    if (c.present) {
      await db
        .insert(tournamentRoster)
        .values({
          id: `${tournamentId}:${c.playerId}`,
          tournamentId,
          playerId: c.playerId,
          injured: c.injured,
        })
        .onConflictDoUpdate({
          target: [tournamentRoster.tournamentId, tournamentRoster.playerId],
          set: { injured: c.injured },
        });
    } else {
      await db
        .delete(tournamentRoster)
        .where(
          and(
            eq(tournamentRoster.tournamentId, tournamentId),
            eq(tournamentRoster.playerId, c.playerId),
          ),
        );
    }
  }
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

const normalizeLineName = (name: string): string => name.trim().toLowerCase();

/** True iff both lists are the same set of players, order aside. */
function samePersonnel(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return setA.size === new Set(b).size && b.every((id) => setA.has(id));
}

/**
 * Two coaches building lines/pods on separate devices can independently pick
 * the same name (e.g. both call something "O-line") — rather than force a
 * sync conflict, merge: an existing line/pod with the same name and the same
 * personnel is just reused (no duplicate); same name but different personnel
 * means the incoming create is the newer definition, so it replaces the old
 * one in place (keeping its id/useCount) instead of sitting alongside it
 * under a confusingly-duplicated name.
 */
export async function createSavedLine(input: {
  id: string;
  teamId: string;
  name: string;
  playerIds: string[];
  color?: LineColor | null;
  side?: ODPreference | null;
}): Promise<SavedLine> {
  const existing = await db
    .select()
    .from(savedLines)
    .where(eq(savedLines.teamId, input.teamId));
  const match = existing.find(
    (l) => normalizeLineName(l.name) === normalizeLineName(input.name),
  );

  if (match) {
    if (samePersonnel(match.playerIds, input.playerIds)) {
      return toSavedLine(match);
    }
    const [row] = await db
      .update(savedLines)
      .set({ playerIds: input.playerIds, color: input.color, side: input.side })
      .where(eq(savedLines.id, match.id))
      .returning();
    return toSavedLine(row!);
  }

  const [row] = await db
    .insert(savedLines)
    .values({
      id: input.id,
      teamId: input.teamId,
      name: input.name,
      playerIds: input.playerIds,
      color: input.color,
      side: input.side,
    })
    .returning();
  return toSavedLine(row!);
}

/**
 * Same merge policy as createSavedLine, applied to edits: renaming (or
 * re-composing) a line/pod into collision with a *different* existing one
 * under the same name is resolved the same way instead of leaving two rows
 * with the same name side by side — identical personnel merges into one
 * (this row is dropped, the other survives); different personnel means this
 * edit is the newer definition, so the other, now-stale row is superseded.
 */
export async function updateSavedLine(
  id: string,
  patch: {
    name?: string;
    playerIds?: string[];
    color?: LineColor | null;
    side?: ODPreference | null;
  },
): Promise<SavedLine | null> {
  const [existing] = await db.select().from(savedLines).where(eq(savedLines.id, id));
  if (!existing) return null;

  if (patch.name !== undefined) {
    const nextPlayerIds = patch.playerIds ?? existing.playerIds;
    const teamLines = await db
      .select()
      .from(savedLines)
      .where(eq(savedLines.teamId, existing.teamId));
    const collision = teamLines.find(
      (l) => l.id !== id && normalizeLineName(l.name) === normalizeLineName(patch.name!),
    );
    if (collision) {
      if (samePersonnel(collision.playerIds, nextPlayerIds)) {
        await db.delete(savedLines).where(eq(savedLines.id, id));
        return toSavedLine(collision);
      }
      await db.delete(savedLines).where(eq(savedLines.id, collision.id));
    }
  }

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
    color: (row.color as LineColor) ?? undefined,
    side: (row.side as ODPreference) ?? undefined,
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
  /**
   * Unread while the game sits in "scheduled" status — the real value is
   * supplied by resolveFlip once the coin flip has actually happened.
   * Defaults to "O" since the frontend no longer collects this at creation.
   */
  startingOD?: OD;
  startingGenderRatio?: GenderRatio;
  fieldNumber?: string;
  gameDate?: string;
  startTime?: string;
  opposingCoachName?: string;
  roster: RosterSnapshotEntry[];
}

export async function createGame(input: CreateGameInput): Promise<GameFull> {
  if (input.tournamentId && input.gameDate) {
    const tournament = await getTournament(input.tournamentId);
    if (
      tournament &&
      (input.gameDate < tournament.startDate ||
        (tournament.endDate && input.gameDate > tournament.endDate))
    ) {
      throw new Error("Game date must fall within the tournament's date range");
    }
  }
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
      startingOD: input.startingOD ?? "O",
      fieldNumber: input.fieldNumber,
      gameDate: input.gameDate,
      startTime: input.startTime,
      opposingCoachName: input.opposingCoachName,
      status: "scheduled",
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

/**
 * Resolves the post-creation coin flip, moving a "scheduled" game to
 * "in_progress" with the details only known once the flip actually happens
 * (§ create-game-form / flip-result-form). Throws if the game isn't
 * currently "scheduled" — this is a one-time transition.
 */
export async function resolveFlip(
  gameId: string,
  patch: { fieldSide: "left" | "right"; teamColor: "light" | "dark"; startingOD: OD },
): Promise<Game> {
  const [existing] = await db.select().from(games).where(eq(games.id, gameId));
  if (!existing) throw new Error("Game not found");
  if (existing.status !== "scheduled") {
    throw new Error("This game's flip has already been resolved");
  }
  const [row] = await db
    .update(games)
    .set({
      fieldSide: patch.fieldSide,
      teamColor: patch.teamColor,
      startingOD: patch.startingOD,
      status: "in_progress",
    })
    .where(eq(games.id, gameId))
    .returning();
  return toGame(row!);
}

/**
 * Updates a game's administrative metadata (§ edit-game-modal) — opponent
 * name, field number, opposing coach name, date/time. Doesn't touch
 * gameplay state (score, roster, flip result), so it's safe at any status.
 */
export async function updateGameMetadata(
  gameId: string,
  patch: {
    opponentName?: string;
    fieldNumber?: string | null;
    gameDate?: string | null;
    startTime?: string | null;
    opposingCoachName?: string | null;
  },
): Promise<Game | null> {
  if (patch.gameDate) {
    const [existing] = await db.select().from(games).where(eq(games.id, gameId));
    if (existing?.tournamentId) {
      const tournament = await getTournament(existing.tournamentId);
      if (
        tournament &&
        (patch.gameDate < tournament.startDate ||
          (tournament.endDate && patch.gameDate > tournament.endDate))
      ) {
        throw new Error("Game date must fall within the tournament's date range");
      }
    }
  }
  const [row] = await db
    .update(games)
    .set(patch)
    .where(eq(games.id, gameId))
    .returning();
  return row ? toGame(row) : null;
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
    fieldNumber: row.fieldNumber ?? undefined,
    gameDate: row.gameDate ?? undefined,
    startTime: row.startTime ?? undefined,
    opposingCoachName: row.opposingCoachName ?? undefined,
    fieldSide: (row.fieldSide as "left" | "right" | null) ?? undefined,
    teamColor: (row.teamColor as "light" | "dark" | null) ?? undefined,
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
