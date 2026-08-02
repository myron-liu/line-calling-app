// Live game engine — §7 state machine.
//
// The point log is the source of truth; LiveGameState is *derived* by folding it
// (deriveLiveGameState). A small amount of non-derivable state (timeouts, halftime,
// manual-end) lives in GameMeta. Every transition is a pure function
// (game, GameLogState, ...args) -> GameLogState, so undo/edit are just "produce a
// new log and re-derive", and the exact same code runs on client and server (§11).

import type {
  Game,
  GameLogState,
  GameMeta,
  GenderRatio,
  LiveGameState,
  OD,
  Point,
  PointResult,
  Scoring,
  StatEvent,
} from "./types";
import { lastPlayedPoint, odForPoint, pointsPlayed, ratioForPoint } from "./rules";

/** The subset of Game the engine reads. */
type GameRules = Pick<
  Game,
  | "id"
  | "gameCap"
  | "halfScore"
  | "timeoutsPerHalf"
  | "startingGenderRatio"
  | "startingOD"
>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreOf(points: Point[]): { our: number; their: number } {
  let our = 0;
  let their = 0;
  for (const p of points) {
    if (p.result === "us") our++;
    else if (p.result === "them") their++;
  }
  return { our, their };
}

/** A game is Mixed (ratio-enforced) iff it has a starting ratio. */
function isMixed(game: GameRules): boolean {
  return game.startingGenderRatio !== undefined;
}

/** The 7 players actually on the field: the starting lineup with injury subs applied. */
function effectiveOnField(point: Point): string[] {
  const onField = [...point.lineup];
  for (const sub of point.substitutions ?? []) {
    const idx = onField.indexOf(sub.injuredPlayerId);
    if (idx !== -1) onField[idx] = sub.replacementPlayerId;
  }
  return onField;
}

interface UpcomingContext {
  pointNumber: number;
  od: OD;
  genderRatio?: GenderRatio;
  isFirstAfterHalftime: boolean;
}

/** Compute O/D, ratio, and ordinal for the *next* (not-yet-created) point. */
function upcomingContext(
  game: GameRules,
  points: Point[],
  meta: GameMeta,
): UpcomingContext {
  const completed = points.filter((p) => p.result !== undefined);
  const pointNumber = completed.length + 1;
  const prev = completed.length ? completed[completed.length - 1]! : null;
  const isFirstAfterHalftime =
    meta.halftimeReached && !points.some((p) => p.isFirstAfterHalftime);
  const od = odForPoint(pointNumber, game, prev, isFirstAfterHalftime);
  const genderRatio =
    isMixed(game) && game.startingGenderRatio
      ? ratioForPoint(pointNumber, game.startingGenderRatio)
      : undefined;
  return { pointNumber, od, genderRatio, isFirstAfterHalftime };
}

/**
 * Recompute the halftime flag from the log alone (used on undo). True if a point
 * was played after half, or either score has reached halfScore. Note: a purely
 * manual halftime that hasn't yet produced a flagged point is not recoverable this
 * way — an accepted v1 limitation, documented on undoLastPoint.
 */
export function deriveHalftimeReached(
  game: GameRules,
  points: Point[],
): boolean {
  if (points.some((p) => p.isFirstAfterHalftime)) return true;
  if (game.halfScore === null) return false;
  const { our, their } = scoreOf(points);
  return our >= game.halfScore || their >= game.halfScore;
}

// ── Derivation ───────────────────────────────────────────────────────────────

/** Fresh meta for a game about to start. */
export function initialMeta(game: GameRules): GameMeta {
  return {
    halftimeReached: false,
    ourTimeoutsRemaining: game.timeoutsPerHalf,
    theirTimeoutsRemaining: game.timeoutsPerHalf,
    endedManually: false,
  };
}

/**
 * Fold the log + meta into the derived live view. Returns one of the *play* phases
 * (awaiting_line | point_in_progress | completed); the pre-start "scheduled" phase
 * is handled by the UI from Game.status, not here.
 */
export function deriveLiveGameState(
  game: GameRules,
  points: Point[],
  meta: GameMeta,
): LiveGameState {
  const { our, their } = scoreOf(points);
  const capReached =
    game.gameCap !== null && (our >= game.gameCap || their >= game.gameCap);
  const inProgress = points.find((p) => p.result === undefined);

  let phase: LiveGameState["phase"];
  let currentPointNumber: number;
  let od: OD;
  let genderRatio: GenderRatio | undefined;
  let currentLineup: string[] = [];

  if (meta.endedManually || capReached) {
    const last = points.length ? points[points.length - 1]! : null;
    phase = "completed";
    currentPointNumber = last ? last.pointNumber : 0;
    od = last ? last.od : game.startingOD;
    genderRatio = last?.genderRatio;
  } else if (inProgress) {
    phase = "point_in_progress";
    currentPointNumber = inProgress.pointNumber;
    od = inProgress.od;
    genderRatio = inProgress.genderRatio;
    currentLineup = effectiveOnField(inProgress);
  } else {
    const ctx = upcomingContext(game, points, meta);
    phase = "awaiting_line";
    currentPointNumber = ctx.pointNumber;
    od = ctx.od;
    genderRatio = ctx.genderRatio;
  }

  return {
    gameId: game.id,
    currentPointNumber,
    ourScore: our,
    theirScore: their,
    od,
    genderRatio,
    halftimeReached: meta.halftimeReached,
    ourTimeoutsRemaining: meta.ourTimeoutsRemaining,
    theirTimeoutsRemaining: meta.theirTimeoutsRemaining,
    phase,
    pointsPlayed: pointsPlayed(points),
    lastPlayedPoint: lastPlayedPoint(points),
    currentLineup,
  };
}

// ── Transitions (pure reducers) ──────────────────────────────────────────────

/** Confirm the line for the upcoming point → point_in_progress. `pointId` is
 *  caller-supplied (game-rules stays pure/id-free); so is `startedAt` (the
 *  game clock's start — every transition here is a pure function of its
 *  arguments, so the caller reads the wall clock, not this module). */
export function confirmLine(
  game: GameRules,
  state: GameLogState,
  lineup: string[],
  pointId: string,
  startedAt?: string,
): GameLogState {
  if (state.meta.endedManually) throw new Error("Game has ended");
  if (state.points.some((p) => p.result === undefined)) {
    throw new Error("A point is already in progress");
  }
  const ctx = upcomingContext(game, state.points, state.meta);
  const point: Point = {
    id: pointId,
    gameId: game.id,
    pointNumber: ctx.pointNumber,
    od: ctx.od,
    genderRatio: ctx.genderRatio,
    lineup: [...lineup],
    isFirstAfterHalftime: ctx.isFirstAfterHalftime,
    result: undefined,
    startedAt,
  };
  return { points: [...state.points, point], meta: state.meta };
}

/**
 * Record who scored the in-progress point. Recording the result *is* the advance
 * to the next point (§8): the next point's O/D and ratio are re-derived on the next
 * confirmLine. Reaching halfScore fires the one-time halftime side effect (reset
 * timeouts; the next confirmed point becomes isFirstAfterHalftime).
 */
export function recordResult(
  game: GameRules,
  state: GameLogState,
  scorer: PointResult,
  endedAt?: string,
  scoring?: Scoring,
): GameLogState {
  const idx = state.points.findIndex((p) => p.result === undefined);
  if (idx === -1) throw new Error("No point in progress");

  // Scoring detail only makes sense for a point we won — silently dropping it
  // otherwise beats trusting a caller that got the pairing wrong.
  const detail = scorer === "us" ? scoring : undefined;
  const points = state.points.map((p, i) =>
    i === idx ? { ...p, result: scorer, endedAt, scoring: detail } : p,
  );

  let meta = state.meta;
  const { our, their } = scoreOf(points);
  const reachedHalf =
    game.halfScore !== null && (our === game.halfScore || their === game.halfScore);
  if (!meta.halftimeReached && reachedHalf) {
    meta = {
      ...meta,
      halftimeReached: true,
      ourTimeoutsRemaining: game.timeoutsPerHalf,
      theirTimeoutsRemaining: game.timeoutsPerHalf,
    };
  }
  return { points, meta };
}

/** What the point after this one would look like under a given result. */
export interface NextPointPreview {
  pointNumber: number;
  od: OD;
  genderRatio?: GenderRatio;
  isFirstAfterHalftime: boolean;
  /** True when this result would end the game, so there's no next line to
   *  prepare (the cap is reached). */
  gameEnds: boolean;
}

/**
 * Look ahead to the next point under a hypothetical result, so the live caller
 * can prepare a line for each outcome while the current point is still being
 * played (§ contingency lines).
 *
 * Deliberately implemented by *running* recordResult against a copy of the log
 * rather than re-deriving anything: which side we're on next, the ABBA ratio,
 * and whether the result crosses halftime are all already encoded there, and a
 * second implementation of those rules would drift from the real one.
 */
export function nextPointIfResult(
  game: GameRules,
  state: GameLogState,
  scorer: PointResult,
): NextPointPreview {
  const after = recordResult(game, state, scorer);
  const ctx = upcomingContext(game, after.points, after.meta);
  const phase = deriveLiveGameState(game, after.points, after.meta).phase;
  return { ...ctx, gameEnds: phase === "completed" };
}

/** Manual halftime (time cap). Idempotent: a second call is a no-op so timeouts
 *  don't double-reset (§6, §12). */
export function callHalftime(game: GameRules, state: GameLogState): GameLogState {
  if (state.meta.halftimeReached) return state;
  return {
    points: state.points,
    meta: {
      ...state.meta,
      halftimeReached: true,
      ourTimeoutsRemaining: game.timeoutsPerHalf,
      theirTimeoutsRemaining: game.timeoutsPerHalf,
    },
  };
}

/** Decrement a team's timeouts; blocked at 0. Does not advance the point. */
export function callTimeout(
  state: GameLogState,
  team: PointResult,
): GameLogState {
  const remaining =
    team === "us"
      ? state.meta.ourTimeoutsRemaining
      : state.meta.theirTimeoutsRemaining;
  if (remaining <= 0) throw new Error("No timeouts remaining");
  const meta =
    team === "us"
      ? { ...state.meta, ourTimeoutsRemaining: remaining - 1 }
      : { ...state.meta, theirTimeoutsRemaining: remaining - 1 };
  return { points: state.points, meta };
}

/**
 * Swap a player off the field mid-point (§8) — for an injury or just a
 * rotation. Records the swap; the starter still counts the point, the
 * replacement does not. Roster eligibility of the replacement is the caller's
 * responsibility (needs roster); here we only enforce on-field constraints.
 *
 * Says nothing about whether anyone is hurt. Locking a player out of later
 * lines is a separate, explicit choice (the roster snapshot's `injured`
 * flag), so a routine sub doesn't quietly shrink the bench.
 */
export function substitute(
  state: GameLogState,
  outgoingPlayerId: string,
  replacementPlayerId: string,
): GameLogState {
  const idx = state.points.findIndex((p) => p.result === undefined);
  if (idx === -1) throw new Error("No point in progress");
  const point = state.points[idx]!;
  if (outgoingPlayerId === replacementPlayerId) {
    throw new Error("Replacement must differ from the player coming off");
  }
  // Checked against who's actually on the field, not the starting 7: a player
  // subbed in earlier this point can come off themselves (and used to be
  // rejected as "not on this line"), and one already subbed off can come back.
  const onField = effectiveOnField(point);
  if (!onField.includes(outgoingPlayerId)) {
    throw new Error("That player is not on this line");
  }
  if (onField.includes(replacementPlayerId)) {
    throw new Error("Replacement is already on this line");
  }
  const updated: Point = {
    ...point,
    substitutions: [
      ...(point.substitutions ?? []),
      { injuredPlayerId: outgoingPlayerId, replacementPlayerId },
    ],
  };
  return {
    points: state.points.map((p, i) => (i === idx ? updated : p)),
    meta: state.meta,
  };
}

// ── Recorded stats — § stats ────────────────────────────────────────────────

/**
 * Credit a D or a turnover to a player on the point currently being played.
 *
 * Validated against who's *actually on the field* (injury subs applied), not
 * the starting 7 — a player subbed in mid-point can absolutely get a block,
 * and one subbed out can't.
 */
export function addStatEvent(
  state: GameLogState,
  event: StatEvent,
): GameLogState {
  const idx = state.points.findIndex((p) => p.result === undefined);
  if (idx === -1) throw new Error("No point in progress");
  const point = state.points[idx]!;
  if (!effectiveOnField(point).includes(event.playerId)) {
    throw new Error("Player is not on the field for this point");
  }
  const updated: Point = {
    ...point,
    statEvents: [...(point.statEvents ?? []), event],
  };
  return {
    points: state.points.map((p, i) => (i === idx ? updated : p)),
    meta: state.meta,
  };
}

/** Drop a single mis-recorded stat event from the in-progress point. Unknown
 *  ids are a no-op, so a double-tap on remove can't throw. */
export function removeStatEvent(
  state: GameLogState,
  eventId: string,
): GameLogState {
  const idx = state.points.findIndex((p) => p.result === undefined);
  if (idx === -1) throw new Error("No point in progress");
  const point = state.points[idx]!;
  const updated: Point = {
    ...point,
    statEvents: (point.statEvents ?? []).filter((e) => e.id !== eventId),
  };
  return {
    points: state.points.map((p, i) => (i === idx ? updated : p)),
    meta: state.meta,
  };
}

/** Manually end the game at the current score (undoable, §13.8). */
export function endGame(state: GameLogState): GameLogState {
  return { points: state.points, meta: { ...state.meta, endedManually: true } };
}

/** Edit a past point's lineup (§7). The caller must validate the new lineup
 *  against that point's LOCKED genderRatio first. */
export function editPointLineup(
  state: GameLogState,
  pointId: string,
  newLineup: string[],
): GameLogState {
  return {
    points: state.points.map((p) =>
      p.id === pointId ? { ...p, lineup: [...newLineup] } : p,
    ),
    meta: state.meta,
  };
}

/**
 * A retroactive correction to an already-played point (§ edit point). Every
 * field is optional; an omitted one is left alone. `scoring: null` clears the
 * goal/Callahan detail, which an omitted key can't express.
 */
export interface PointEdit {
  lineup?: string[];
  result?: PointResult;
  scoring?: Scoring | null;
  statEvents?: StatEvent[];
}

/**
 * Amend a point after the fact — who was on, who scored it, and the Ds and
 * turnovers recorded against it. Reached from the line-history tab and the
 * end-game recap, for the inevitable "that was Sam, not Alex".
 *
 * Flipping a result rewrites the score, so halftime is re-derived from the
 * amended log. What it deliberately does *not* do is re-derive later points'
 * stored O/D: those record which side the team actually started each point
 * on, and that really happened regardless of a scoring correction made
 * afterward. Rewriting them would silently contradict the coach's own record
 * of the game.
 *
 * Editing the in-progress point's result isn't allowed — that's what
 * recordResult is for, and letting it through here would leave the game with
 * no point in progress and no advance.
 */
export function editPoint(
  game: GameRules,
  state: GameLogState,
  pointId: string,
  edit: PointEdit,
): GameLogState {
  const idx = state.points.findIndex((p) => p.id === pointId);
  if (idx === -1) throw new Error("No such point");
  const point = state.points[idx]!;
  if (edit.result !== undefined && point.result === undefined) {
    throw new Error("Record the result from the live caller, not the history");
  }
  if (edit.lineup && edit.lineup.length !== point.lineup.length) {
    throw new Error(`A line needs exactly ${point.lineup.length} players`);
  }
  if (edit.lineup && new Set(edit.lineup).size !== edit.lineup.length) {
    throw new Error("That line has the same player on it twice");
  }

  const result = edit.result ?? point.result;
  const updated: Point = {
    ...point,
    lineup: edit.lineup ? [...edit.lineup] : point.lineup,
    result,
    // Scoring detail only survives on a point we won — flipping the result to
    // "them" drops it rather than leaving a goal credited on a point we lost.
    scoring:
      result !== "us"
        ? undefined
        : edit.scoring === null
          ? undefined
          : (edit.scoring ?? point.scoring),
    statEvents: edit.statEvents ? [...edit.statEvents] : point.statEvents,
  };

  const points = state.points.map((p, i) => (i === idx ? updated : p));
  return {
    points,
    meta: { ...state.meta, halftimeReached: deriveHalftimeReached(game, points) },
  };
}

/** How to reverse a one-step undo — replaying the exact reducer call it
 *  reverted, so redo() can just re-dispatch it instead of duplicating logic. */
export type RedoAction =
  | { type: "confirmLine"; lineup: string[]; pointId: string; startedAt?: string }
  | { type: "recordResult"; scorer: PointResult; endedAt?: string; scoring?: Scoring }
  | { type: "endGame" }
  | { type: "callHalftime" };

export interface UndoResult extends GameLogState {
  /** The reverted point's line, so the UI can pre-select it for a re-call.
   *  Set only when undo un-confirms a line (back to awaiting_line); null
   *  otherwise, since the other cases don't return to line-building. */
  restoredLineup: string[] | null;
  /** Replay this via redo() to reapply exactly what was just undone. */
  redo: RedoAction;
}

/**
 * One-step undo (§7), phase-aware: reverts whichever single transition most
 * recently moved the game forward, so the coach lands back on the previous
 * screen rather than always losing a whole point.
 *
 *  - Manually ended → un-end (back to whatever phase the score implies).
 *  - Halftime is flagged but no point actually crossed it (a manual
 *    "Halftime" tap, not the score reaching halfScore) → clear the flag; the
 *    timeout reset from calling it isn't reversed (there's no record of what
 *    they were before), but that's a rare, low-stakes edge of undoing an
 *    accidental tap.
 *  - A line is confirmed but undecided (point_in_progress) → un-confirm it,
 *    back to awaiting_line for the same point, with its lineup restored so
 *    the coach can re-pick or just re-confirm it.
 *  - Otherwise the last point is already decided (awaiting_line for the
 *    next point) → un-record *just* its result, back to point_in_progress
 *    for it. The point and its lineup are untouched — undoing the lineup
 *    itself is a second, separate undo away.
 *
 * Strictly one level deep; older corrections go through editPointLineup.
 */
export function undoLastPoint(
  game: GameRules,
  state: GameLogState,
): UndoResult {
  if (state.meta.endedManually) {
    return {
      points: state.points,
      meta: { ...state.meta, endedManually: false },
      restoredLineup: null,
      redo: { type: "endGame" },
    };
  }
  if (state.meta.halftimeReached && !deriveHalftimeReached(game, state.points)) {
    return {
      points: state.points,
      meta: { ...state.meta, halftimeReached: false },
      restoredLineup: null,
      redo: { type: "callHalftime" },
    };
  }
  if (state.points.length === 0) throw new Error("Nothing to undo");
  const last = state.points[state.points.length - 1]!;

  if (last.result === undefined) {
    return {
      points: state.points.slice(0, -1),
      meta: state.meta,
      restoredLineup: last.lineup,
      redo: {
        type: "confirmLine",
        lineup: last.lineup,
        pointId: last.id,
        startedAt: last.startedAt,
      },
    };
  }

  const lastEndedAt = last.endedAt;
  const lastScoring = last.scoring;
  const points = state.points.map((p, i) =>
    i === state.points.length - 1
      ? { ...p, result: undefined, endedAt: undefined, scoring: undefined }
      : p,
  );
  const wasHalftime = state.meta.halftimeReached;
  const nowHalftime = deriveHalftimeReached(game, points);
  const meta: GameMeta = { ...state.meta, halftimeReached: nowHalftime };
  if (wasHalftime && !nowHalftime) {
    // Undo crossed back before half: restore the first-half timeout baseline.
    meta.ourTimeoutsRemaining = game.timeoutsPerHalf;
    meta.theirTimeoutsRemaining = game.timeoutsPerHalf;
  }
  return {
    points,
    meta,
    restoredLineup: null,
    redo: {
      type: "recordResult",
      scorer: last.result,
      endedAt: lastEndedAt,
      scoring: lastScoring,
    },
  };
}

/** Reapply a RedoAction captured from undoLastPoint's result, by re-dispatching
 *  the exact reducer call it reverted — so redo can never drift from undo,
 *  and the original startedAt/endedAt (not a fresh "now") is restored too. */
export function redoAction(
  game: GameRules,
  state: GameLogState,
  action: RedoAction,
): GameLogState {
  switch (action.type) {
    case "confirmLine":
      return confirmLine(game, state, action.lineup, action.pointId, action.startedAt);
    case "recordResult":
      return recordResult(game, state, action.scorer, action.endedAt, action.scoring);
    case "endGame":
      return endGame(state);
    case "callHalftime":
      return callHalftime(game, state);
  }
}
