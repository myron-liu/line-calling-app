import { describe, expect, test } from "bun:test";
import {
  currentCapStatus,
  strategyOutcomes,
  usedStrategyTags,
  offensiveEfficiency,
  defensiveEfficiency,
  invertRatio,
  ratioForPoint,
  ratioCounts,
  genderStateLabel,
  invertOD,
  odForPoint,
  pointsPlayed,
  lastPlayedPoint,
  playerSecondsPlayed,
  halfScoreForCap,
  teamPointOutcomes,
  playerPointOutcomes,
  suggestedSituationTag,
  totalPlayedSeconds,
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

describe("playerSecondsPlayed (§4.4, game clock)", () => {
  const mk = (
    n: number,
    lineup: string[],
    result: "us" | "them" | undefined,
    startedAt?: string,
    endedAt?: string,
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
    startedAt,
    endedAt,
  });

  test("credits each starter with the point's full duration", () => {
    const log = [
      mk(1, ["a", "b", "c"], "us", "2024-01-01T00:00:00Z", "2024-01-01T00:01:30Z"),
      mk(2, ["a", "b", "d"], "them", "2024-01-01T00:02:00Z", "2024-01-01T00:02:45Z"),
    ];
    expect(playerSecondsPlayed(log)).toEqual({ a: 135, b: 135, c: 90, d: 45 });
  });

  test("a mid-point injury replacement doesn't split the duration", () => {
    const log = [
      mk(1, ["a", "b", "c"], "us", "2024-01-01T00:00:00Z", "2024-01-01T00:01:00Z", [
        { injuredPlayerId: "a", replacementPlayerId: "z" },
      ]),
    ];
    const seconds = playerSecondsPlayed(log);
    expect(seconds["a"]).toBe(60);
    expect(seconds["z"]).toBeUndefined();
  });

  test("in-progress and legacy (no-timestamp) points don't contribute", () => {
    const log = [
      mk(1, ["a", "b"], "us", "2024-01-01T00:00:00Z", "2024-01-01T00:01:00Z"),
      mk(2, ["a", "c"], undefined, "2024-01-01T00:02:00Z"), // in progress
      mk(3, ["a", "d"], "them"), // legacy, no timestamps at all
    ];
    expect(playerSecondsPlayed(log)).toEqual({ a: 60, b: 60 });
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

  test("playerPointOutcomes tallies points played and +/- per player, split by O/D starting side", () => {
    const log = [
      mk(1, "O", ["a", "b"], "us"), // O hold: a,b +1 O
      mk(2, "O", ["a", "c"], "them"), // O broken: a,c -1 O
      mk(3, "D", ["a", "b"], "us"), // D break: a,b +1 D
      mk(4, "D", ["a", "c"], "them"), // D opponent held: a,c -1 D
    ];
    const out = playerPointOutcomes(log);
    expect(out["a"]).toEqual({
      oPointsPlayed: 2,
      dPointsPlayed: 2,
      oPlusMinus: 0,
      dPlusMinus: 0,
    });
    expect(out["b"]).toEqual({
      oPointsPlayed: 1,
      dPointsPlayed: 1,
      oPlusMinus: 1,
      dPlusMinus: 1,
    });
    expect(out["c"]).toEqual({
      oPointsPlayed: 1,
      dPointsPlayed: 1,
      oPlusMinus: -1,
      dPlusMinus: -1,
    });
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

describe("totalPlayedSeconds (game clock)", () => {
  const mk = (startedAt?: string, endedAt?: string, result?: "us" | "them"): Point => ({
    id: "p",
    gameId: "g",
    pointNumber: 1,
    od: "O",
    lineup: [],
    result,
    isFirstAfterHalftime: false,
    startedAt,
    endedAt,
  });

  test("sums duration across points with both timestamps", () => {
    const points = [
      mk("2024-01-01T00:00:00.000Z", "2024-01-01T00:01:30.000Z", "us"),
      mk("2024-01-01T00:02:00.000Z", "2024-01-01T00:02:45.000Z", "them"),
    ];
    expect(totalPlayedSeconds(points)).toBe(90 + 45);
  });

  test("ignores points missing either timestamp (legacy or in-progress)", () => {
    const points = [
      mk("2024-01-01T00:00:00.000Z", "2024-01-01T00:01:00.000Z", "us"),
      mk("2024-01-01T00:02:00.000Z", undefined, undefined), // in progress
      mk(undefined, undefined, "them"), // legacy point, no timestamps at all
    ];
    expect(totalPlayedSeconds(points)).toBe(60);
  });

  test("empty log -> 0", () => {
    expect(totalPlayedSeconds([])).toBe(0);
  });
});

describe("suggestedSituationTag (quick-lines default tag filter)", () => {
  const mk = (n: number, od: "O" | "D", result: "us" | "them", firstAfterHalf = false): Point => ({
    id: `p${n}`,
    gameId: "g",
    pointNumber: n,
    od,
    lineup: [],
    result,
    isFirstAfterHalftime: firstAfterHalf,
  });

  test("tight game with no sharper trigger -> Standard", () => {
    expect(suggestedSituationTag(15, 5, 4, false, [])).toBe("Standard");
    expect(suggestedSituationTag(15, 4, 5, false, [])).toBe("Standard");
  });

  test("ahead by 4+ -> Developmental", () => {
    expect(suggestedSituationTag(15, 10, 6, false, [])).toBe("Developmental");
  });

  test("behind by 4+ is not Developmental (must be ahead, not just a big margin)", () => {
    expect(suggestedSituationTag(15, 6, 10, false, [])).toBe("Standard");
  });

  test("no sharper trigger, not tight -> Standard (the blanket default)", () => {
    // margin 3: not tight (<=2), not ahead by 4+, no half/universe/broken trigger.
    expect(suggestedSituationTag(15, 6, 3, false, [])).toBe("Standard");
  });

  test("this point could reach halfScore -> Kill", () => {
    // 15-cap -> halfScore 8; ourScore 7 means winning this point reaches 8.
    expect(suggestedSituationTag(15, 7, 3, false, [])).toBe("Kill");
  });

  test("halftime point doesn't fire once halftime is already reached", () => {
    expect(suggestedSituationTag(15, 7, 3, true, [])).not.toBe("Kill");
  });

  test("universe point (someone at cap-1) -> Kill", () => {
    expect(suggestedSituationTag(15, 14, 10, true, [])).toBe("Kill");
  });

  test("one point away from universe (someone at cap-2) -> Kill", () => {
    expect(suggestedSituationTag(15, 13, 10, true, [])).toBe("Kill");
  });

  test("broken twice in a row -> Kill, even in a blowout", () => {
    const points = [mk(1, "O", "them"), mk(2, "O", "them")];
    expect(suggestedSituationTag(15, 10, 4, false, points)).toBe("Kill");
  });

  test("broken once, then held -> not triggered by broken-twice rule", () => {
    const points = [mk(1, "O", "them"), mk(2, "O", "us")];
    expect(suggestedSituationTag(15, 6, 5, false, points)).toBe("Standard");
  });

  test("first point back from halftime in a tight game -> Kill", () => {
    // halftimeReached=true, no completed point yet flagged isFirstAfterHalftime
    // -> the point about to be built is the first one back from half.
    expect(suggestedSituationTag(15, 8, 7, true, [])).toBe("Kill");
  });

  test("first point back from halftime in a blowout -> not Kill", () => {
    expect(suggestedSituationTag(15, 12, 4, true, [])).toBe("Developmental");
  });

  test("second point back from halftime doesn't retrigger the first-after-half rule", () => {
    const points = [mk(1, "O", "us", true)];
    expect(suggestedSituationTag(15, 8, 7, true, points)).toBe("Standard");
  });

  test("time-cap games (gameCap null) skip half/universe triggers", () => {
    expect(suggestedSituationTag(null, 6, 5, false, [])).toBe("Standard");
    expect(suggestedSituationTag(null, 10, 6, false, [])).toBe("Developmental");
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

describe("currentCapStatus", () => {
  const caps = { halfCapMinutes: 40, softCapMinutes: 75, hardCapMinutes: 90 };

  test("stays quiet until a cap is within the warning window", () => {
    expect(currentCapStatus(caps, 0)).toBeNull();
    expect(currentCapStatus(caps, 24)).toBeNull();
    expect(currentCapStatus(caps, 25)).toEqual({
      label: "Half cap",
      minutesRemaining: 15,
      reached: false,
    });
  });

  test("counts down, then flips to reached", () => {
    expect(currentCapStatus(caps, 39.5)?.minutesRemaining).toBe(0);
    expect(currentCapStatus(caps, 39.5)?.reached).toBe(false);
    expect(currentCapStatus(caps, 40)).toMatchObject({
      label: "Half cap",
      reached: true,
    });
  });

  test("reports the most advanced cap passed, not the earliest", () => {
    // Past soft cap and inside hard cap's window: the coach needs to hear
    // "soft cap", not still be told about half.
    expect(currentCapStatus(caps, 80)).toMatchObject({
      label: "Soft cap",
      reached: true,
    });
    expect(currentCapStatus(caps, 95)).toMatchObject({
      label: "Hard cap",
      reached: true,
    });
  });

  test("handles a partially configured or empty set of caps", () => {
    expect(currentCapStatus({}, 500)).toBeNull();
    expect(currentCapStatus({ hardCapMinutes: 90 }, 10)).toBeNull();
    expect(currentCapStatus({ hardCapMinutes: 90 }, 80)).toMatchObject({
      label: "Hard cap",
      minutesRemaining: 10,
      reached: false,
    });
  });
});

describe("strategyOutcomes", () => {
  const pt = (
    n: number,
    od: "O" | "D",
    result: "us" | "them" | undefined,
    strategyTags?: string[],
  ): Point => ({
    id: `p${n}`,
    gameId: "g",
    pointNumber: n,
    od,
    lineup: [],
    result,
    isFirstAfterHalftime: false,
    strategyTags,
  });

  test("splits each tag's record by the side it started on", () => {
    const points = [
      pt(1, "D", "us", ["Zone"]), // break
      pt(2, "D", "them", ["Zone"]), // opponent held
      pt(3, "D", "us", ["Person"]), // break
      pt(4, "O", "us", ["Person"]), // hold
      pt(5, "O", "them", ["Zone"]), // broken
    ];
    const byTag = Object.fromEntries(strategyOutcomes(points).map((s) => [s.tag, s]));

    expect(byTag["Zone"]!.outcomes).toEqual({
      holds: 0,
      broken: 1,
      breaks: 1,
      opponentHolds: 1,
    });
    expect(defensiveEfficiency(byTag["Zone"]!.outcomes)).toBe(0.5);
    expect(offensiveEfficiency(byTag["Zone"]!.outcomes)).toBe(0);

    expect(defensiveEfficiency(byTag["Person"]!.outcomes)).toBe(1);
    expect(offensiveEfficiency(byTag["Person"]!.outcomes)).toBe(1);
  });

  test("a point with several tags counts toward each", () => {
    const result = strategyOutcomes([pt(1, "D", "us", ["Zone", "Junk"])]);
    expect(result.map((s) => s.tag).sort()).toEqual(["Junk", "Zone"]);
    expect(result.every((s) => s.outcomes.breaks === 1)).toBe(true);
  });

  test("ignores untagged and in-progress points", () => {
    const points = [
      pt(1, "D", "us"), // untagged
      pt(2, "D", undefined, ["Zone"]), // still being played
      pt(3, "D", "us", ["Zone"]),
    ];
    const zone = strategyOutcomes(points).find((s) => s.tag === "Zone")!;
    expect(zone.pointsPlayed).toBe(1);
  });

  test("orders by most played, then by name", () => {
    const points = [
      pt(1, "O", "us", ["Person"]),
      pt(2, "O", "us", ["Person"]),
      pt(3, "O", "us", ["Zone"]),
      pt(4, "O", "us", ["Junk"]),
    ];
    expect(strategyOutcomes(points).map((s) => s.tag)).toEqual([
      "Person",
      "Junk",
      "Zone",
    ]);
  });

  test("usedStrategyTags collects the vocabulary in use", () => {
    const points = [
      pt(1, "O", "us", ["Zone"]),
      pt(2, "O", undefined, ["Junk"]), // in progress still contributes a tag
      pt(3, "O", "us", ["Zone", "Person"]),
    ];
    expect(usedStrategyTags(points)).toEqual(["Junk", "Person", "Zone"]);
  });
});
