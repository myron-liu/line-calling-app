// Per-game local store: the append-only point log (source of truth), the small bit
// of explicit non-derived state, and the roster snapshot taken at Start.
// LiveGameState is *derived* from these via @shared/game-rules (see deriveState, M2).

import type {
  Game,
  GameMeta,
  GenderMatch,
  ODPreference,
  Point,
  Role,
} from "@shared/game-rules";
import { keys } from "./keys";
import { read, write, type WriteResult } from "./store";

// ── Game config ────────────────────────────────────────────────────────────────

export function readGameConfig(gameId: string): Game | null {
  return read<Game | null>(keys.gameConfig(gameId), null);
}

export function writeGameConfig(game: Game): WriteResult {
  return write(keys.gameConfig(game.id), game);
}

/** Eligible roster frozen at Start so the live game works offline (§13.12). Kept
 *  in sync with the tournament's check-in roster afterward (see syncTournament
 *  GameRosters in games.ts) — added/removed players update `active`, but existing
 *  entries are never deleted, so past line history still resolves player names. */
export interface RosterSnapshotEntry {
  playerId: string;
  name: string;
  nickname?: string;
  genderMatch: GenderMatch;
  role: Role;
  odPreference?: ODPreference;
  jerseyNumber?: number;
  injured: boolean;
  /** False once removed from the tournament's check-in roster. Missing = active. */
  active?: boolean;
}

/** True unless a player has been explicitly removed from the check-in roster. */
export function isRosterActive(p: RosterSnapshotEntry): boolean {
  return p.active !== false;
}

/** The shape returned by `POST /games`, `GET /games/:id/full`, and a successful
 *  `PUT /games/:id/sync` — everything needed to seed or replace the local cache. */
export interface GameFull {
  game: Game;
  meta: GameMeta;
  roster: RosterSnapshotEntry[];
  points: Point[];
}

// ── Point log ────────────────────────────────────────────────────────────────

export function readLog(gameId: string): Point[] {
  return read<Point[]>(keys.gameLog(gameId), []);
}

export function writeLog(gameId: string, points: Point[]): WriteResult {
  return write(keys.gameLog(gameId), points);
}

export function appendPoint(gameId: string, point: Point): WriteResult {
  return writeLog(gameId, [...readLog(gameId), point]);
}

/** Replace a single point by id (edit line history / record result). */
export function replacePoint(gameId: string, point: Point): WriteResult {
  const next = readLog(gameId).map((p) => (p.id === point.id ? point : p));
  return writeLog(gameId, next);
}

// ── Meta & roster snapshot ─────────────────────────────────────────────────────

export function readMeta(gameId: string): GameMeta | null {
  return read<GameMeta | null>(keys.gameMeta(gameId), null);
}

export function writeMeta(gameId: string, meta: GameMeta): WriteResult {
  return write(keys.gameMeta(gameId), meta);
}

export function readRosterSnapshot(gameId: string): RosterSnapshotEntry[] {
  return read<RosterSnapshotEntry[]>(keys.gameRoster(gameId), []);
}

export function writeRosterSnapshot(
  gameId: string,
  roster: RosterSnapshotEntry[],
): WriteResult {
  return write(keys.gameRoster(gameId), roster);
}

/** Toggle a player's injured flag in the game's roster snapshot (§8). Injury is
 *  scoped to this game's snapshot and locks the player out of new lines until
 *  cleared. Returns the updated roster. */
export function setRosterInjured(
  gameId: string,
  playerId: string,
  injured: boolean,
): RosterSnapshotEntry[] {
  const next = readRosterSnapshot(gameId).map((e) =>
    e.playerId === playerId ? { ...e, injured } : e,
  );
  writeRosterSnapshot(gameId, next);
  return next;
}

// ── Last sync (§ manual resync) ────────────────────────────────────────────────

export function readLastSyncedAt(gameId: string): string | null {
  return read<string | null>(keys.gameLastSync(gameId), null);
}

export function writeLastSyncedAt(gameId: string, iso: string): WriteResult {
  return write(keys.gameLastSync(gameId), iso);
}

// ── Active-game index (powers the switcher, §13.13) ────────────────────────────

export function activeGameIds(): string[] {
  return read<string[]>(keys.gameIndex, []);
}

export function registerGame(gameId: string): void {
  const ids = activeGameIds();
  if (!ids.includes(gameId)) write(keys.gameIndex, [...ids, gameId]);
}

export function unregisterGame(gameId: string): void {
  write(
    keys.gameIndex,
    activeGameIds().filter((id) => id !== gameId),
  );
}
