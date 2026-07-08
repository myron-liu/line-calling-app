// Canonical domain schema for the line-calling app.
// Mirrors §4 of line-calling-app-design.md. Shared by the Next.js client and the
// Bun server so the rules run identically on both sides (§11).

// ── Enums / unions ──────────────────────────────────────────────────────────

export type Division = "mixed" | "open" | "women";
export type Role = "handler" | "cutter" | "both";
export type GenderMatch = "MMP" | "WMP";

/** Mixed-only: which gender is in the majority for a given point. */
export type GenderRatio = "4MMP_3WMP" | "4WMP_3MMP";
export type OD = "O" | "D";
export type GameCap = 13 | 15;

/** A player's preferred side of the disc; "both" means no strong preference. */
export type ODPreference = OD | "both";

export type GameStatus = "scheduled" | "in_progress" | "completed";
export type GamePhase =
  | "scheduled"
  | "awaiting_line"
  | "point_in_progress"
  | "completed";

export type PointResult = "us" | "them";

// ── Entities ────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  /** E.164, e.g. "+14155550123". Unique. The login identity. */
  phoneNumber: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface Team {
  id: string;
  ownerId: string;
  name: string;
  division: Division;
  createdAt: string;
}

export interface Player {
  id: string;
  teamId: string;
  name: string;
  /** Optional short name shown on the sideline; falls back to `name`. */
  nickname?: string;
  /** Required to validate lines against a gender ratio in Mixed. */
  genderMatch: GenderMatch;
  role: Role;
  /** Preferred side of the disc; defaults to "both" when unset. */
  odPreference?: ODPreference;
  jerseyNumber?: number;
  createdAt: string;
}

export interface Tournament {
  id: string;
  teamId: string;
  name: string;
  division: Division;
  startDate: string;
  endDate?: string;
  /** Locks genderMatch edits for rostered players once true. */
  started: boolean;
  createdAt: string;
}

/** Which team players are present for this tournament (a subset of the roster). */
export interface TournamentRoster {
  id: string;
  tournamentId: string;
  playerId: string;
  /** Locks the player out of new lines; tournament-scoped, toggleable. */
  injured: boolean;
  createdAt: string;
}

/** Coach-assigned color for a saved line/pod chip in the quick-lines bar. */
export type LineColor = "red" | "green" | "blue" | "yellow" | "black" | "purple";

export interface SavedLine {
  id: string;
  teamId: string;
  name: string;
  /** 1..7 players (a full line or a partial pod). */
  playerIds: string[];
  /** Times this line/pod has actually been played (a confirmed point's final
   *  lineup was a superset of it) — not incremented merely by tapping it
   *  during line-building, since the selection can still change before
   *  confirming. Undefined = 0. */
  useCount?: number;
  /** Optional coach-assigned color for the quick-lines chip. Unset = default
   *  line/pod coloring. */
  color?: LineColor;
  /** Which side this line/pod is meant for; unset/"both" means it shows up
   *  for either. Drives quick-lines sort order (current side's pods first). */
  side?: ODPreference;
  createdAt: string;
}

export interface Game {
  id: string;
  teamId: string;
  /** Undefined for a standalone/individual game not tied to a tournament. */
  tournamentId?: string;
  opponentName: string;
  gameCap: GameCap;
  /** Derived: 7 if cap 13, 8 if cap 15. Stored for convenience. */
  halfScore: number;
  timeoutsPerHalf: number;

  /** Mixed only. Null/ignored for Open & Women. */
  startingGenderRatio?: GenderRatio;
  /**
   * O or D for the very first point of the game. While `status` is
   * "scheduled" this is an unread placeholder — the real value is set by
   * the post-creation flip-result step, which flips status to "in_progress".
   */
  startingOD: OD;

  /** Optional, filled in at creation time. */
  fieldNumber?: string;
  /** ISO date (YYYY-MM-DD). For a tournament game, constrained to the
   *  tournament's startDate–endDate range by the creation form. */
  gameDate?: string;
  startTime?: string;
  opposingCoachName?: string;

  /**
   * Decided at the coin flip, after creation — unset while `status` is
   * "scheduled". "left"/"right" is relative to home, i.e. where your team's
   * sideline stuff is.
   */
  fieldSide?: "left" | "right";
  /** Decided at the coin flip, after creation — unset while `status` is "scheduled". */
  teamColor?: "light" | "dark";

  status: GameStatus;
  createdAt: string;
  /**
   * Optimistic-concurrency counter, bumped by the server on every successful
   * `PUT /games/:id/sync`. A sync sent with a stale version is rejected (409)
   * instead of blindly overwriting another device's concurrent changes — see
   * apps/server/src/db/queries.ts's syncGame.
   */
  version: number;
}

export interface Substitution {
  injuredPlayerId: string;
  replacementPlayerId: string;
}

export interface Point {
  id: string;
  gameId: string;
  /** 1-based ordinal across the whole game. */
  pointNumber: number;
  od: OD;
  /** Mixed only; LOCKED for this point ordinal (ABBA). */
  genderRatio?: GenderRatio;
  /** The STARTING 7 for the point. */
  lineup: string[];
  substitutions?: Substitution[];
  /** Who scored; undefined while the point is in progress. */
  result?: PointResult;
  isFirstAfterHalftime: boolean;
}

/**
 * Explicit, non-derivable game state that can't be folded from the point log
 * alone: timeout counts (timeout calls aren't points), the halftime flag (a manual
 * halftime before the next line is confirmed lives only here), and the manual-end
 * flag. Everything else in LiveGameState is derived from the point log.
 */
export interface GameMeta {
  halftimeReached: boolean;
  ourTimeoutsRemaining: number;
  theirTimeoutsRemaining: number;
  /** Set by the manual, undoable "End game" control (§13.8). */
  endedManually: boolean;
}

/** The persisted, mutable pair the reducers operate on: log + explicit meta. */
export interface GameLogState {
  points: Point[];
  meta: GameMeta;
}

/** Derived view; see deriveLiveGameState (M2). */
export interface LiveGameState {
  gameId: string;
  currentPointNumber: number;
  ourScore: number;
  theirScore: number;
  od: OD;
  genderRatio?: GenderRatio;
  halftimeReached: boolean;
  ourTimeoutsRemaining: number;
  theirTimeoutsRemaining: number;
  phase: GamePhase;
  /** Auto-counted: playerId -> number of points they STARTED. */
  pointsPlayed: Record<string, number>;
  /**
   * playerId -> ordinal of the last completed point they started. Missing means
   * they haven't started a point yet this game — used to flag long benches.
   */
  lastPlayedPoint: Record<string, number>;
  /**
   * Players currently ON the field for the in-progress point (starting 7 with any
   * injury subs applied). Empty unless phase is point_in_progress.
   */
  currentLineup: string[];
}
