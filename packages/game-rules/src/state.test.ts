import { describe, expect, test } from "bun:test";
import {
  initialMeta,
  deriveLiveGameState,
  confirmLine,
  recordResult,
  callHalftime,
  callTimeout,
  injurySub,
  endGame,
  editPointLineup,
  undoLastPoint,
  redoAction,
} from "./state";
import type { Game, GameLogState, PointResult } from "./types";

// A 13-cap mixed game: half at 7, starting O, ratio A = 4MMP_3WMP, 2 timeouts/half.
const game: Game = {
  id: "g1",
  teamId: "team1",
  tournamentId: "t1",
  opponentName: "Sockeye",
  gameCap: 13,
  halfScore: 7,
  timeoutsPerHalf: 2,
  startingGenderRatio: "4MMP_3WMP",
  startingOD: "O",
  status: "in_progress",
  createdAt: "2026-07-01T00:00:00Z",
  version: 1,
};

const line = (n: number) =>
  Array.from({ length: 7 }, (_, i) => `p${n}_${i}`);

function fresh(): GameLogState {
  return { points: [], meta: initialMeta(game) };
}

/** Confirm a line and immediately record a result; returns the new state. */
function playPoint(
  state: GameLogState,
  scorer: PointResult,
  lineup = line(state.points.length + 1),
): GameLogState {
  const withLine = confirmLine(game, state, lineup, `pt-${state.points.length + 1}`);
  return recordResult(game, withLine, scorer);
}

describe("initial derivation", () => {
  test("empty game awaits line 1 with starting O/D and ratio A", () => {
    const s = fresh();
    const live = deriveLiveGameState(game, s.points, s.meta);
    expect(live).toMatchObject({
      phase: "awaiting_line",
      currentPointNumber: 1,
      ourScore: 0,
      theirScore: 0,
      od: "O",
      genderRatio: "4MMP_3WMP",
      ourTimeoutsRemaining: 2,
    });
  });
});

describe("confirmLine / recordResult advance", () => {
  test("confirm → point_in_progress with snapshotted ratio", () => {
    const s = confirmLine(game, fresh(), line(1), "pt-1");
    const live = deriveLiveGameState(game, s.points, s.meta);
    expect(live.phase).toBe("point_in_progress");
    expect(s.points[0]!.genderRatio).toBe("4MMP_3WMP");
    expect(s.points[0]!.od).toBe("O");
  });

  test("we score → on D next point; ratio advances A→B", () => {
    const s = playPoint(fresh(), "us");
    const live = deriveLiveGameState(game, s.points, s.meta);
    expect(live).toMatchObject({
      phase: "awaiting_line",
      currentPointNumber: 2,
      ourScore: 1,
      theirScore: 0,
      od: "D", // we scored, so we pull next → on defense
      genderRatio: "4WMP_3MMP",
    });
  });

  test("they score → on O next point", () => {
    const s = playPoint(fresh(), "them");
    const live = deriveLiveGameState(game, s.points, s.meta);
    expect(live.od).toBe("O");
    expect(live.theirScore).toBe(1);
  });

  test("cannot confirm while a point is in progress", () => {
    const s = confirmLine(game, fresh(), line(1), "pt-1");
    expect(() => confirmLine(game, s, line(2), "pt-2")).toThrow();
  });

  test("points-played counts starting lineups", () => {
    let s = fresh();
    s = playPoint(s, "us", ["a", "b", "c", "d", "e", "f", "g"]);
    s = playPoint(s, "them", ["a", "b", "c", "d", "e", "f", "x"]);
    const live = deriveLiveGameState(game, s.points, s.meta);
    expect(live.pointsPlayed["a"]).toBe(2);
    expect(live.pointsPlayed["g"]).toBe(1);
    expect(live.pointsPlayed["x"]).toBe(1);
  });
});

describe("halftime", () => {
  test("reaching halfScore fires halftime, resets timeouts, flips O/D next point", () => {
    let s = fresh();
    // us scores 7 straight → reaches half at 7–0.
    for (let i = 0; i < 7; i++) s = playPoint(s, "us");
    expect(s.meta.halftimeReached).toBe(true);
    expect(s.meta.ourTimeoutsRemaining).toBe(2);

    const live = deriveLiveGameState(game, s.points, s.meta);
    // Opened the game on O; first point of second half is the inverse: D.
    expect(live.od).toBe("D");

    // Confirm the next point → it's flagged first-after-halftime.
    const s2 = confirmLine(game, s, line(8), "pt-8");
    expect(s2.points[7]!.isFirstAfterHalftime).toBe(true);
  });

  test("ABBA continues across halftime (no reset)", () => {
    let s = fresh();
    for (let i = 0; i < 8; i++) s = playPoint(s, i % 2 === 0 ? "us" : "them");
    // Point 9's ratio = A again (phase 0), regardless of half.
    const live = deriveLiveGameState(game, s.points, s.meta);
    expect(live.currentPointNumber).toBe(9);
    expect(live.genderRatio).toBe("4MMP_3WMP");
  });

  test("manual halftime is idempotent; later score at half does not re-reset", () => {
    let s = fresh();
    s = playPoint(s, "us"); // 1–0
    s = callHalftime(game, s);
    s = callTimeout(s, "us"); // burn a timeout after the reset
    expect(s.meta.ourTimeoutsRemaining).toBe(1);
    // Play up to a 7 — the score-half trigger must NOT reset timeouts again.
    for (let i = 0; i < 6; i++) s = playPoint(s, "us"); // reaches 7
    expect(s.meta.ourTimeoutsRemaining).toBe(1);
  });
});

describe("timeouts", () => {
  test("decrement then block at zero", () => {
    let s = fresh();
    s = callTimeout(s, "them");
    s = callTimeout(s, "them");
    expect(s.meta.theirTimeoutsRemaining).toBe(0);
    expect(() => callTimeout(s, "them")).toThrow();
  });
});

describe("injury hot-sub", () => {
  test("records the swap; validates on-field constraints", () => {
    const s = confirmLine(
      game,
      fresh(),
      ["a", "b", "c", "d", "e", "f", "g"],
      "pt-1",
    );
    const subbed = injurySub(s, "a", "z");
    expect(subbed.points[0]!.substitutions).toEqual([
      { injuredPlayerId: "a", replacementPlayerId: "z" },
    ]);
    // Injured starter still counts; replacement doesn't.
    const done = recordResult(game, subbed, "us");
    const live = deriveLiveGameState(game, done.points, done.meta);
    expect(live.pointsPlayed["a"]).toBe(1);
    expect(live.pointsPlayed["z"]).toBeUndefined();
  });

  test("rejects replacement already on the line or equal to injured", () => {
    const s = confirmLine(
      game,
      fresh(),
      ["a", "b", "c", "d", "e", "f", "g"],
      "pt-1",
    );
    expect(() => injurySub(s, "a", "b")).toThrow();
    expect(() => injurySub(s, "a", "a")).toThrow();
  });
});

describe("undo (one step, phase-aware)", () => {
  test("point_in_progress → un-confirms the line, back to awaiting_line for the same point", () => {
    const s = confirmLine(game, fresh(), line(1), "pt-1");
    const undone = undoLastPoint(game, s);
    const live = deriveLiveGameState(game, undone.points, undone.meta);
    expect(live).toMatchObject({ phase: "awaiting_line", currentPointNumber: 1 });
    expect(undone.points).toHaveLength(0);
    expect(undone.restoredLineup).toEqual(line(1));
    expect(undone.redo).toEqual({ type: "confirmLine", lineup: line(1), pointId: "pt-1" });
  });

  test("awaiting_line → un-records just the previous point's result, back to point_in_progress", () => {
    let s = fresh();
    s = playPoint(s, "us", ["a", "b", "c", "d", "e", "f", "g"]); // 1–0
    s = playPoint(s, "them"); // 1–1, awaiting line 3
    const undone = undoLastPoint(game, s);
    const live = deriveLiveGameState(game, undone.points, undone.meta);
    // The point-2 lineup/id are untouched — only its result was cleared.
    expect(live).toMatchObject({
      phase: "point_in_progress",
      currentPointNumber: 2,
      ourScore: 1,
      theirScore: 0,
    });
    expect(undone.points).toHaveLength(2);
    expect(undone.restoredLineup).toBeNull();
    expect(undone.redo).toEqual({ type: "recordResult", scorer: "them" });
  });

  test("undo across the halftime boundary clears the flag and restores timeouts", () => {
    let s = fresh();
    for (let i = 0; i < 7; i++) s = playPoint(s, "us"); // 7–0, half reached
    expect(s.meta.halftimeReached).toBe(true);
    const undone = undoLastPoint(game, s); // back to 6–0
    expect(undone.meta.halftimeReached).toBe(false);
    expect(undone.meta.ourTimeoutsRemaining).toBe(2);
    const live = deriveLiveGameState(game, undone.points, undone.meta);
    expect(live.ourScore).toBe(6);
  });

  test("a manual halftime call (score not at halfScore) undoes as its own step", () => {
    let s = fresh();
    s = playPoint(s, "us"); // 1–0, well short of halfScore (7)
    s = callHalftime(game, s);
    expect(s.meta.halftimeReached).toBe(true);
    const undone = undoLastPoint(game, s);
    expect(undone.meta.halftimeReached).toBe(false);
    expect(undone.points).toHaveLength(1); // the point itself is untouched
    expect(undone.redo).toEqual({ type: "callHalftime" });
    const redone = redoAction(game, undone, undone.redo);
    expect(redone.meta.halftimeReached).toBe(true);
  });

  test("redoAction replays exactly what undo reverted", () => {
    let s = fresh();
    s = playPoint(s, "us"); // 1–0, awaiting line 2
    const midLine = confirmLine(game, s, line(2), "pt-2");
    const undoneConfirm = undoLastPoint(game, midLine);
    const redoneConfirm = redoAction(game, undoneConfirm, undoneConfirm.redo);
    expect(redoneConfirm).toEqual(midLine);

    const decided = playPoint(s, "them"); // reuse `s`, decide point 2
    const undoneResult = undoLastPoint(game, decided);
    const redoneResult = redoAction(game, undoneResult, undoneResult.redo);
    expect(redoneResult).toEqual(decided);
  });
});

describe("game completion", () => {
  test("reaching cap completes the game", () => {
    let s = fresh();
    for (let i = 0; i < 13; i++) s = playPoint(s, "us");
    const live = deriveLiveGameState(game, s.points, s.meta);
    expect(live.phase).toBe("completed");
    expect(live.ourScore).toBe(13);
  });

  test("manual end completes; undo reopens it", () => {
    let s = fresh();
    s = playPoint(s, "us"); // 1–0, awaiting line 2
    s = endGame(s);
    expect(deriveLiveGameState(game, s.points, s.meta).phase).toBe("completed");
    const reopened = undoLastPoint(game, s);
    expect(deriveLiveGameState(game, reopened.points, reopened.meta).phase).toBe(
      "awaiting_line",
    );
  });

  test("time-cap game (gameCap/halfScore null) never auto-completes or auto-halftimes", () => {
    const timeCapGame: Game = { ...game, gameCap: null, halfScore: null };
    let s: GameLogState = { points: [], meta: initialMeta(timeCapGame) };
    for (let i = 0; i < 20; i++) {
      const lineup = Array.from({ length: 7 }, (_, j) => `p${i}_${j}`);
      s = recordResult(
        timeCapGame,
        confirmLine(timeCapGame, s, lineup, `pt-${i + 1}`),
        "us",
      );
    }
    const live = deriveLiveGameState(timeCapGame, s.points, s.meta);
    expect(live.ourScore).toBe(20);
    expect(live.phase).toBe("awaiting_line"); // no cap to reach, so still going
    expect(s.meta.halftimeReached).toBe(false); // no halfScore to auto-trigger it

    // Manual halftime still works, and undoing it still works.
    const halved = callHalftime(timeCapGame, s);
    expect(halved.meta.halftimeReached).toBe(true);
    const undoneHalf = undoLastPoint(timeCapGame, halved);
    expect(undoneHalf.meta.halftimeReached).toBe(false);

    // Only a manual end actually completes it.
    const ended = endGame(s);
    expect(deriveLiveGameState(timeCapGame, ended.points, ended.meta).phase).toBe(
      "completed",
    );
  });
});

describe("edit line history", () => {
  test("replaces a past lineup without touching score", () => {
    let s = fresh();
    s = playPoint(s, "us", ["a", "b", "c", "d", "e", "f", "g"]);
    const edited = editPointLineup(s, "pt-1", ["a", "b", "c", "d", "e", "f", "h"]);
    const live = deriveLiveGameState(game, edited.points, edited.meta);
    expect(live.ourScore).toBe(1); // unchanged
    expect(live.pointsPlayed["g"]).toBeUndefined();
    expect(live.pointsPlayed["h"]).toBe(1);
  });
});
