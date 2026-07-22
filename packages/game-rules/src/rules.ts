// Pure rules engine — §5 (ABBA), §6 (O/D & halftime), §4.4 (points played).
// No I/O, no dates, no randomness: every function is a pure function of its inputs
// so it can be exhaustively unit-tested and run identically on client and server.

import type { GameCapMode, GenderRatio, OD, Game, Point, SituationTag } from "./types";

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

// ── Point outcomes (holds/breaks) — recap stats ─────────────────────────────

/**
 * Team-wide tally of each point outcome by the side it started on: a "hold"
 * is a point started on O that we won, "broken" is one started on O that we
 * lost; a "break" is a point started on D that we won, and the opponent
 * "held" is one started on D that we lost. Only completed points count.
 */
export interface TeamPointOutcomes {
  holds: number;
  broken: number;
  breaks: number;
  opponentHolds: number;
}

export function teamPointOutcomes(points: Point[]): TeamPointOutcomes {
  const out: TeamPointOutcomes = { holds: 0, broken: 0, breaks: 0, opponentHolds: 0 };
  for (const p of points) {
    if (p.result === undefined) continue;
    if (p.od === "O") {
      if (p.result === "us") out.holds++;
      else out.broken++;
    } else {
      if (p.result === "us") out.breaks++;
      else out.opponentHolds++;
    }
  }
  return out;
}

/**
 * Per-player points played and +/- split by the side each point started on:
 * a count plus a net (+1 for a point their team won, -1 for one it lost) for
 * O-starting and D-starting points each. Same counting convention as
 * pointsPlayed — starting lineup only, sub-ins excluded, only completed
 * points.
 */
export interface PlayerPointOutcomes {
  oPointsPlayed: number;
  dPointsPlayed: number;
  oPlusMinus: number;
  dPlusMinus: number;
}

export function playerPointOutcomes(
  points: Point[],
): Record<string, PlayerPointOutcomes> {
  const out: Record<string, PlayerPointOutcomes> = {};
  for (const p of points) {
    if (p.result === undefined) continue;
    const delta = p.result === "us" ? 1 : -1;
    for (const id of p.lineup) {
      const entry = out[id] ?? {
        oPointsPlayed: 0,
        dPointsPlayed: 0,
        oPlusMinus: 0,
        dPlusMinus: 0,
      };
      if (p.od === "O") {
        entry.oPointsPlayed++;
        entry.oPlusMinus += delta;
      } else {
        entry.dPointsPlayed++;
        entry.dPlusMinus += delta;
      }
      out[id] = entry;
    }
  }
  return out;
}

// ── Half score derivation — §4.2 ─────────────────────────────────────────────

/** 7 for a 13-cap, 8 for a 15-cap, null for a time-cap game (no auto-halftime
 *  score threshold — see GameCapMode). */
export function halfScoreForCap(cap: GameCapMode): number | null {
  return cap === null ? null : cap === 13 ? 7 : 8;
}

// ── Situational tag suggestion (quick-lines default filter) ─────────────────

/**
 * Advisory default for which fixed SituationTag the live caller's quick-lines
 * tag filter should start on for the point about to be built — the coach can
 * always override it for that point (see live-caller.tsx, which recomputes
 * fresh each point rather than fighting a manual choice mid-point).
 *
 * "Tight" (margin <= 2) and "comfortably ahead" (margin >= 4) are judgment
 * calls with no universal definition — easy to retune here if they don't
 * match how a coach actually plays.
 *
 * Priority (first match wins) favors your sharpest personnel whenever
 * something concerning is happening, over just riding a comfortable lead:
 *   1. Kill    — broken twice in a row; this point could end a half or the
 *                game (someone's one point from halfScore/gameCap, i.e.
 *                "Universe" or the point before it); or it's the first point
 *                back from halftime in a tight game.
 *   2. Developmental — ahead by 4+.
 *   3. Standard — tight, with no sharper Kill trigger above.
 *   4. null — no strong situational signal; leave the filter on "All".
 */
export function suggestedSituationTag(
  gameCap: GameCapMode,
  ourScore: number,
  theirScore: number,
  halftimeReached: boolean,
  points: Point[],
): SituationTag | null {
  const margin = Math.abs(ourScore - theirScore);
  const isTight = margin <= 2;

  // True iff either score is exactly one point short of `threshold` — i.e.
  // this point, if won, would reach it.
  const nears = (threshold: number | null) =>
    threshold !== null && (ourScore === threshold - 1 || theirScore === threshold - 1);

  const isHalftimePoint = !halftimeReached && nears(halfScoreForCap(gameCap));
  const isUniverseOrNearUniverse =
    gameCap !== null && (nears(gameCap) || nears(gameCap - 1));
  const isFirstAfterHalf =
    halftimeReached && !points.some((p) => p.isFirstAfterHalftime);

  const completed = points.filter((p) => p.result !== undefined);
  const lastTwo = completed.slice(-2);
  const brokenTwiceInARow =
    lastTwo.length === 2 && lastTwo.every((p) => p.od === "O" && p.result === "them");

  if (
    brokenTwiceInARow ||
    isHalftimePoint ||
    isUniverseOrNearUniverse ||
    (isFirstAfterHalf && isTight)
  ) {
    return "Kill";
  }
  if (ourScore - theirScore >= 4) return "Developmental";
  if (isTight) return "Standard";
  return null;
}
