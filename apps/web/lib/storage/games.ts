// Game creation + listing. Creating a game is "setup" (§13.12): it POSTs to the
// API server, which assigns the id and freezes the initial roster snapshot. The
// response is then seeded into the local per-game cache (config/meta/log/roster)
// so the live caller can run entirely offline from that point on — see
// apps/web/lib/storage/gameLog.ts and lib/game/useLiveGame.ts.

import type { Game, GameCap, GenderRatio, OD, Player } from "@shared/game-rules";
import { halfScoreForCap } from "@shared/game-rules";
import { api } from "../api/client";
import {
  registerGame,
  unregisterGame,
  writeGameConfig,
  writeLastSyncedAt,
  writeLog,
  writeMeta,
  writeRosterSnapshot,
  type GameFull,
  type RosterSnapshotEntry,
} from "./gameLog";

export function listTournamentGames(tournamentId: string): Promise<Game[]> {
  return api.get<Game[]>(`/tournaments/${tournamentId}/games`);
}

// ── Roster snapshot helper ─────────────────────────────────────────────────────

export function rosterSnapshot(
  players: Player[],
  injuredIds: ReadonlySet<string> = new Set(),
): RosterSnapshotEntry[] {
  return players.map((p) => ({
    playerId: p.id,
    name: p.name,
    nickname: p.nickname,
    genderMatch: p.genderMatch,
    role: p.role,
    odPreference: p.odPreference,
    jerseyNumber: p.jerseyNumber,
    injured: injuredIds.has(p.id),
    active: true,
  }));
}

// ── Create ─────────────────────────────────────────────────────────────────────

export interface CreateGameInput {
  teamId: string;
  tournamentId?: string;
  opponentName: string;
  gameCap: GameCap;
  timeoutsPerHalf: number;
  /** Set for Mixed only. */
  startingGenderRatio?: GenderRatio;
  fieldNumber?: string;
  gameDate?: string;
  startTime?: string;
  opposingCoachName?: string;
  roster: RosterSnapshotEntry[];
}

export async function createGame(input: CreateGameInput): Promise<Game> {
  const full = await api.post<GameFull>("/games", {
    teamId: input.teamId,
    tournamentId: input.tournamentId,
    opponentName: input.opponentName,
    gameCap: input.gameCap,
    halfScore: halfScoreForCap(input.gameCap),
    timeoutsPerHalf: input.timeoutsPerHalf,
    startingGenderRatio: input.startingGenderRatio,
    fieldNumber: input.fieldNumber,
    gameDate: input.gameDate,
    startTime: input.startTime,
    opposingCoachName: input.opposingCoachName,
    roster: input.roster,
  });

  writeGameConfig(full.game);
  writeMeta(full.game.id, full.meta);
  writeLog(full.game.id, full.points);
  writeRosterSnapshot(full.game.id, full.roster);
  writeLastSyncedAt(full.game.id, new Date().toISOString());
  registerGame(full.game.id); // show in the live-game switcher (§13.13)
  return full.game;
}

// ── Flip result ──────────────────────────────────────────────────────────────

/** Resolves the post-creation coin flip (§ flip-result-form), moving a
 *  "scheduled" game to "in_progress". Updates the local game-config cache so
 *  the live caller unlocks immediately. */
export async function resolveFlip(
  gameId: string,
  patch: {
    fieldSide: "left" | "right";
    teamColor: "light" | "dark";
    startingOD: OD;
    startingGenderRatio?: GenderRatio;
  },
): Promise<Game> {
  const game = await api.post<Game>(`/games/${gameId}/resolve-flip`, patch);
  writeGameConfig(game);
  return game;
}

/** Reverts a resolved flip back to "scheduled" (see queries.ts's undoFlip) —
 *  only valid before the game's first point has been recorded. */
export async function undoFlip(gameId: string): Promise<Game> {
  const game = await api.post<Game>(`/games/${gameId}/undo-flip`, {});
  writeGameConfig(game);
  return game;
}

// ── Metadata edit ────────────────────────────────────────────────────────────

export interface GameMetadataPatch {
  opponentName?: string;
  fieldNumber?: string | null;
  gameDate?: string | null;
  startTime?: string | null;
  opposingCoachName?: string | null;
}

/** Edits a game's administrative details (§ edit-game-modal) — safe at any
 *  status since it never touches gameplay state. Updates the local
 *  game-config cache too, in case this game is also open in the live caller. */
export async function updateGameMetadata(
  gameId: string,
  patch: GameMetadataPatch,
): Promise<Game> {
  const game = await api.patch<Game>(`/games/${gameId}/metadata`, patch);
  writeGameConfig(game);
  return game;
}

// ── Delete ───────────────────────────────────────────────────────────────────

/** Permanently deletes a game. Also drops it from this device's local
 *  live-game switcher/cache, in case it was ever opened here. */
export async function deleteGame(gameId: string): Promise<void> {
  await api.delete(`/games/${gameId}`);
  unregisterGame(gameId);
}
