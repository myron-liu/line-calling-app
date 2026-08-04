import { describe, expect, test } from "bun:test";
import {
  emptyNextLineDrafts,
  lineForResult,
  planFor,
  prunePlans,
  setPlan,
  type NextLineDrafts,
  type PointPlans,
} from "./contingency";

const drafts = (over: Partial<NextLineDrafts>): NextLineDrafts => ({
  ...emptyNextLineDrafts(),
  ...over,
});

describe("lineForResult", () => {
  test("uses the 'no matter what' line when that outcome has none", () => {
    const d = drafts({ any: ["a", "b"] });
    expect(lineForResult(d, "us")).toEqual(["a", "b"]);
    expect(lineForResult(d, "them")).toEqual(["a", "b"]);
  });

  test("an outcome's own line beats the general one", () => {
    const d = drafts({ us: ["x"], any: ["a", "b"] });
    expect(lineForResult(d, "us")).toEqual(["x"]);
    expect(lineForResult(d, "them")).toEqual(["a", "b"]); // still falls back
  });

  test("empty everywhere carries nothing", () => {
    expect(lineForResult(emptyNextLineDrafts(), "us")).toEqual([]);
  });
});

describe("point plans", () => {
  test("setPlan writes one outcome without disturbing the others", () => {
    let plans: PointPlans = {};
    plans = setPlan(plans, 6, "any", ["a"]);
    plans = setPlan(plans, 6, "us", ["b"]);
    expect(planFor(plans, 6)).toEqual({ us: ["b"], them: [], any: ["a"] });
  });

  test("an unplanned point reads as empty rather than undefined", () => {
    expect(planFor({}, 9)).toEqual(emptyNextLineDrafts());
  });

  test("plans stay put as points are played — nothing shifts", () => {
    // Planned while point 5 was live; still under those keys once 5 ends.
    const plans = setPlan(setPlan({}, 6, "any", ["a"]), 7, "any", ["b"]);
    expect(planFor(plans, 6).any).toEqual(["a"]);
    expect(planFor(plans, 7).any).toEqual(["b"]);
  });

  test("pruning drops played points and keeps upcoming ones", () => {
    let plans: PointPlans = {};
    plans = setPlan(plans, 5, "any", ["old"]);
    plans = setPlan(plans, 6, "any", ["next"]);
    const pruned = prunePlans(plans, 5);
    expect(Object.keys(pruned)).toEqual(["6"]);
    expect(planFor(pruned, 5).any).toEqual([]);
  });
});
