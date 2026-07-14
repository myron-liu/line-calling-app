import { describe, expect, test } from "bun:test";
import {
  invertRatio,
  ratioForPoint,
  ratioCounts,
  genderStateLabel,
  invertOD,
  odForPoint,
  pointsPlayed,
  lastPlayedPoint,
  halfScoreForCap,
  teamPointOutcomes,
  playerPointOutcomes,
} from "./rules";
import { validateLine, lineWarnings, type LinePlayer } from "./validation";
import type { GenderRatio, Point } from "./types";

describe("ratioForPoint (ABBA, §5)", () => {
  // Worked example from §5: startingGenderRatio = 4MMP_3WMP.
  const A: GenderRatio = "4MMP_3WMP";
  const B: GenderRatio = "4WMP_3MMP";
  const expected = [A, B, B, A, A, B, B, A]; // points 1..8

  test("matches the worked-example table", () => {
    for (let i = 0; i < expected.length; i++) {
      expect(ratioForPoint(i + 1, A)).toBe(expected[i]!);
    }
  });

  test("continues across halftime with no reset", () => {
    // Half at point 7/8 doesn't reset the cycle; point 9 restarts the A B B A phase.
    expect(ratioForPoint(9, A)).toBe(A);
    expect(ratioForPoint(12, A)).toBe(A);
    expect(ratioForPoint(10, A)).toBe(B);
  });

  test("inverting the start inverts every point", () => {
    for (let n = 1; n <= 8; n++) {
      expect(ratioForPoint(n, B)).toBe(invertRatio(ratioForPoint(n, A)));
    }
  });
});

describe("genderStateLabel (ABBA gender-match state)", () => {
  test("man-matching start matches the worked example", () => {
    const seq = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      genderStateLabel(n, "4MMP_3WMP"),
    );
    expect(seq).toEqual(["M2", "W1", "W2", "M1", "M2", "W1", "W2"]);
  });

  test("woman-matching start mirrors", () => {
    const seq = [1, 2, 3, 4].map((n) => genderStateLabel(n, "4WMP_3MMP"));
    expect(seq).toEqual(["W2", "M1", "M2", "W1"]);
  });

  test("label's gender always agrees with the majority ratio", () => {
    for (let n = 1; n <= 8; n++) {
      const label = genderStateLabel(n, "4MMP_3WMP");
      const majorityIsMan = ratioForPoint(n, "4MMP_3WMP") === "4MMP_3WMP";
      expect(label.startsWith("M")).toBe(majorityIsMan);
    }
  });
});

describe("invertRatio / ratioCounts", () => {
  test("invertRatio is an involution", () => {
    expect(invertRatio(invertRatio("4MMP_3WMP"))).toBe("4MMP_3WMP");
  });
  test("ratioCounts", () => {
    expect(ratioCounts("4MMP_3WMP")).toEqual({ mmp: 4, wmp: 3 });
    expect(ratioCounts("4WMP_3MMP")).toEqual({ mmp: 3, wmp: 4 });
  });
});

describe("odForPoint (§6)", () => {
  const game = { startingOD: "O" as const };
  const scored = (result: "us" | "them"): Point => ({
    id: "p",
    gameId: "g",
    pointNumber: 1,
    od: "O",
    lineup: [],
    result,
    isFirstAfterHalftime: false,
  });

  test("point 1 uses startingOD", () => {
    expect(odForPoint(1, game, null, false)).toBe("O");
    expect(odForPoint(1, { startingOD: "D" }, null, false)).toBe("D");
  });

  test("first point after halftime inverts startingOD", () => {
    expect(odForPoint(8, game, scored("us"), true)).toBe("D");
    expect(odForPoint(8, { startingOD: "D" }, scored("them"), true)).toBe("O");
  });

  test("normal point: scoring team pulls (goes on D)", () => {
    expect(odForPoint(3, game, scored("us"), false)).toBe("D");
    expect(odForPoint(3, game, scored("them"), false)).toBe("O");
  });

  test("throws if a normal point has no previous point", () => {
    expect(() => odForPoint(3, game, null, false)).toThrow();
  });

  test("invertOD", () => {
    expect(invertOD("O")).toBe("D");
    expect(invertOD("D")).toBe("O");
  });
});

describe("pointsPlayed (§4.4)", () => {
  const mk = (
    n: number,
    lineup: string[],
    result?: "us" | "them",
    substitutions?: { injuredPlayerId: string; replacementPlayerId: string }[],
  ): Point => ({
    id: `p${n}`,
    gameId: "g",
    pointNumber: n,
    od: "O",
    lineup,
    result,
    substitutions,
    isFirstAfterHalftime: false,
  });

  test("counts starting lineups of completed points only", () => {
    const log = [
      mk(1, ["a", "b", "c"], "us"),
      mk(2, ["a", "b", "d"], "them"),
      mk(3, ["a", "e", "f"], undefined), // in progress: not counted
    ];
    expect(pointsPlayed(log)).toEqual({ a: 2, b: 2, c: 1, d: 1 });
  });

  test("injury replacement is not counted; injured starter still is", () => {
    const log = [
      mk(1, ["a", "b", "c"], "us", [
        { injuredPlayerId: "a", replacementPlayerId: "z" },
      ]),
    ];
    const counts = pointsPlayed(log);
    expect(counts["a"]).toBe(1);
    expect(counts["z"]).toBeUndefined();
  });

  test("lastPlayedPoint tracks the most recent completed point each starter had", () => {
    const log = [
      mk(1, ["a", "b", "c"], "us"),
      mk(2, ["a", "b", "d"], "them"),
      mk(3, ["a", "e", "f"], undefined), // in progress: not counted
    ];
    expect(lastPlayedPoint(log)).toEqual({ a: 2, b: 2, c: 1, d: 2 });
    // e/f are only on the in-progress point, so they haven't "played" yet.
    expect(lastPlayedPoint(log)["e"]).toBeUndefined();
  });

  test("lastPlayedPoint: sub-in replacement doesn't count as having played", () => {
    const log = [
      mk(1, ["a", "b", "c"], "us", [
        { injuredPlayerId: "a", replacementPlayerId: "z" },
      ]),
    ];
    const last = lastPlayedPoint(log);
    expect(last["a"]).toBe(1);
    expect(last["z"]).toBeUndefined();
  });
});

describe("teamPointOutcomes / playerPointOutcomes (recap stats)", () => {
  const mk = (
    n: number,
    od: "O" | "D",
    lineup: string[],
    result?: "us" | "them",
  ): Point => ({
    id: `p${n}`,
    gameId: "g",
    pointNumber: n,
    od,
    lineup,
    result,
    isFirstAfterHalftime: false,
  });

  test("teamPointOutcomes tallies holds/broken/breaks/opponentHolds by starting side", () => {
    const log = [
      mk(1, "O", ["a", "b"], "us"), // hold
      mk(2, "O", ["a", "b"], "them"), // broken
      mk(3, "D", ["a", "b"], "us"), // break
      mk(4, "D", ["a", "b"], "them"), // opponent held
      mk(5, "O", ["a", "b"], undefined), // in progress: not counted
    ];
    expect(teamPointOutcomes(log)).toEqual({
      holds: 1,
      broken: 1,
      breaks: 1,
      opponentHolds: 1,
    });
  });

  test("playerPointOutcomes tallies +/- per player, split by O/D starting side", () => {
    const log = [
      mk(1, "O", ["a", "b"], "us"), // O hold: a,b +1 O
      mk(2, "O", ["a", "c"], "them"), // O broken: a,c -1 O
      mk(3, "D", ["a", "b"], "us"), // D break: a,b +1 D
      mk(4, "D", ["a", "c"], "them"), // D opponent held: a,c -1 D
    ];
    const out = playerPointOutcomes(log);
    expect(out["a"]).toEqual({ oPlusMinus: 0, dPlusMinus: 0 });
    expect(out["b"]).toEqual({ oPlusMinus: 1, dPlusMinus: 1 });
    expect(out["c"]).toEqual({ oPlusMinus: -1, dPlusMinus: -1 });
  });

  test("only completed points count", () => {
    const log = [mk(1, "O", ["a"], undefined)];
    expect(playerPointOutcomes(log)).toEqual({});
    expect(teamPointOutcomes(log)).toEqual({
      holds: 0,
      broken: 0,
      breaks: 0,
      opponentHolds: 0,
    });
  });
});

describe("halfScoreForCap (§4.2)", () => {
  test("13 -> 7, 15 -> 8", () => {
    expect(halfScoreForCap(13)).toBe(7);
    expect(halfScoreForCap(15)).toBe(8);
  });
});

describe("validateLine (§8)", () => {
  const eligible = new Set(["m1", "m2", "m3", "m4", "w1", "w2", "w3", "w4"]);
  const mk = (id: string, gm: "MMP" | "WMP"): LinePlayer => ({
    id,
    genderMatch: gm,
    role: "cutter",
  });

  const mixedLine = [
    mk("m1", "MMP"),
    mk("m2", "MMP"),
    mk("m3", "MMP"),
    mk("m4", "MMP"),
    mk("w1", "WMP"),
    mk("w2", "WMP"),
    mk("w3", "WMP"),
  ];

  test("valid 4MMP/3WMP mixed line", () => {
    const r = validateLine({
      division: "mixed",
      requiredRatio: "4MMP_3WMP",
      players: mixedLine,
      eligiblePlayerIds: eligible,
    });
    expect(r.valid).toBe(true);
    expect(r).toMatchObject({ mmp: 4, wmp: 3 });
  });

  test("wrong ratio is a hard block", () => {
    const r = validateLine({
      division: "mixed",
      requiredRatio: "4WMP_3MMP", // needs 3 MMP / 4 WMP, line has 4/3
      players: mixedLine,
      eligiblePlayerIds: eligible,
    });
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("ratio_mmp");
  });

  test("open/women: any 7 eligible players pass", () => {
    const r = validateLine({
      division: "open",
      players: mixedLine,
      eligiblePlayerIds: eligible,
    });
    expect(r.valid).toBe(true);
  });

  test("ineligible player blocks", () => {
    const withInjured = [...mixedLine.slice(0, 6), mk("hurt", "WMP")];
    const r = validateLine({
      division: "mixed",
      requiredRatio: "4MMP_3WMP",
      players: withInjured,
      eligiblePlayerIds: eligible,
    });
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("ineligible");
  });

  test("wrong count blocks", () => {
    const r = validateLine({
      division: "open",
      players: mixedLine.slice(0, 6),
      eligiblePlayerIds: eligible,
    });
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("wrong_count");
  });
});

describe("lineWarnings (§8, soft)", () => {
  test("flags a line with no handler", () => {
    const players: LinePlayer[] = [
      { id: "a", genderMatch: "MMP", role: "cutter" },
    ];
    const w = lineWarnings({ players, pointsPlayed: {}, squadAveragePoints: 0 });
    expect(w.map((x) => x.code)).toContain("no_handler");
  });

  test("flags a heavily-overplayed player", () => {
    const players: LinePlayer[] = [
      { id: "a", genderMatch: "MMP", role: "handler" },
    ];
    const w = lineWarnings({
      players,
      pointsPlayed: { a: 10 },
      squadAveragePoints: 4,
    });
    expect(w.map((x) => x.code)).toContain("time_imbalance");
  });
});
