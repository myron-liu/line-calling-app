// Pure rules engine — §5 (ABBA), §6 (O/D & halftime), §4.4 (points played).
// No I/O, no dates, no randomness: every function is a pure function of its inputs
// so it can be exhaustively unit-tested and run identically on client and server.

import type { GenderRatio, OD, Game, Point } from "./types";

// ── Gender ratio (ABBA) — §5 ─────────────────────────────────────────────────

export function invertRatio(r: GenderRatio): GenderRatio {
  return r === "4MMP_3WMP" ? "4WMP_3MMP" : "4MMP_3WMP";
}

/**
 * The ratio for a point is a pure function of its 1-based ordinal, following the
 * cycle A B B A | A B B A | ... It continues across halftime (no reset).
 */
export function ratioForPoint(
  pointNumber: number,
  startA: GenderRatio,
): GenderRatio {
  const phase = (pointNumber - 1) % 4; // 0,1,2,3
  const isA = phase === 0 || phase === 3; // A B B A
  return isA ? startA : invertRatio(startA);
}

/** MMP/WMP counts required by a ratio. */
export function ratioCounts(ratio: GenderRatio): { mmp: number; wmp: number } {
  return ratio === "4MMP_3WMP" ? { mmp: 4, wmp: 3 } : { mmp: 3, wmp: 4 };
}

/**
 * The "gender-match state" label for a point (Mixed only): which slot of the ABBA
 * four-point cycle this point occupies. M-labels fall on MMP-majority (4MMP) points,
 * W-labels on WMP-majority (4WMP) points; the number distinguishes the two slots of
 * that gender within the cycle. Starting man-matching (4MMP_3WMP) the cycle runs
 * `M2 · W1 · W2 · M1` and repeats; starting woman-matching it mirrors.
 *
 *   point:  1   2   3   4  | 5   6   7   8
 *   label:  M2  W1  W2  M1 | M2  W1  W2  M1   (man-matching start)
 */
export function genderStateLabel(
  pointNumber: number,
  startA: GenderRatio,
): string {
  const phase = (pointNumber - 1) % 4; // 0..3 → M2, W1, W2, M1
  const cycle =
    startA === "4MMP_3WMP"
      ? ["M2", "W1", "W2", "M1"]
      : ["W2", "M1", "M2", "W1"];
  return cycle[phase]!;
}

// ── Offense / Defense — §6 ───────────────────────────────────────────────────

export const invertOD = (od: OD): OD => (od === "O" ? "D" : "O");

/**
 * O/D for a point, in priority order:
 *   1. First point of the game        -> game.startingOD
 *   2. First point after halftime      -> invert(game.startingOD)
 *   3. Otherwise                        -> scoring team pulls, so they're on D
 */
export function odForPoint(
  pointNumber: number,
  game: Pick<Game, "startingOD">,
  prev: Point | null,
  isFirstAfterHalftime: boolean,
): OD {
  if (pointNumber === 1) return game.startingOD;
  if (isFirstAfterHalftime) return invertOD(game.startingOD);
  if (!prev) {
    throw new Error(`odForPoint: point ${pointNumber} has no previous point`);
  }
  return prev.result === "us" ? "D" : "O";
}

// ── Points played — §4.4 ─────────────────────────────────────────────────────

/**
 * Counts the STARTING lineup of each completed point. Mid-point injury
 * replacements are intentionally NOT counted; the injured starter still is.
 * Derived from the log, so it stays correct through undo and edit-history.
 */
export function pointsPlayed(points: Point[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of points) {
    if (p.result === undefined) continue; // only completed points count
    for (const id of p.lineup) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/**
 * The ordinal of the most recent completed point each player started. Same
 * counting convention as pointsPlayed — starting lineup only, sub-ins excluded —
 * so "last played" and "points played" always agree on who counts as playing.
 * Absent from the result means they haven't started a point yet this game.
 */
export function lastPlayedPoint(points: Point[]): Record<string, number> {
  const last: Record<string, number> = {};
  for (const p of points) {
    if (p.result === undefined) continue;
    for (const id of p.lineup) last[id] = p.pointNumber;
  }
  return last;
}

// ── Half score derivation — §4.2 ─────────────────────────────────────────────

/** 7 for a 13-cap, 8 for a 15-cap. */
export function halfScoreForCap(cap: 13 | 15): number {
  return cap === 13 ? 7 : 8;
}
