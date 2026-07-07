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
  startingOD: OD;
  /** Set for Mixed only. */
  startingGenderRatio?: GenderRatio;
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
    startingOD: input.startingOD,
    startingGenderRatio: input.startingGenderRatio,
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
