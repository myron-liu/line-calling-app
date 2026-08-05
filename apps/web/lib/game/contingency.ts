import type { PointResult } from "@shared/game-rules";

/**
 * Lines prepared for the point in progress, one per way it can end.
 *
 * "any" is the line to run regardless of the result — useful when the next
 * point's personnel matters more than which side you're on. It's used for
 * whichever outcome actually lands, unless that outcome has a line of its own.
 */
export type ContingencyKey = PointResult | "any";
export type NextLineDrafts = Record<ContingencyKey, string[]>;

export const emptyNextLineDrafts = (): NextLineDrafts => ({
  us: [],
  them: [],
  any: [],
});

/**
 * The line to carry into the next point, given how this one ended.
 *
 * An outcome's own line wins over the general one: picking "if we score"
 * specifically is the more deliberate choice, so it shouldn't be overridden by
 * a fallback the coach set earlier.
 */
export function lineForResult(
  drafts: NextLineDrafts,
  scorer: PointResult,
): string[] {
  return drafts[scorer].length > 0 ? drafts[scorer] : drafts.any;
}

export const OUTCOME_LABEL: Record<ContingencyKey, string> = {
  us: "If we score",
  them: "If they score",
  any: "No matter what",
};

/** Display order of the contingency tabs. */
export const CONTINGENCIES: ContingencyKey[] = ["us", "them", "any"];

/**
 * Lines planned for upcoming points, keyed by absolute point number.
 *
 * Keying by point number rather than by "how many points from now" is what
 * makes the plan survive a point ending: when point 5 finishes, the planner
 * simply starts drawing rows at 6, and whatever was planned for 6 and 7 is
 * already sitting there under those keys. Nothing shifts.
 */
export type PointPlans = Record<number, NextLineDrafts>;

export function planFor(plans: PointPlans, pointNumber: number): NextLineDrafts {
  return plans[pointNumber] ?? emptyNextLineDrafts();
}

export function setPlan(
  plans: PointPlans,
  pointNumber: number,
  outcome: ContingencyKey,
  lineup: string[],
): PointPlans {
  return {
    ...plans,
    [pointNumber]: { ...planFor(plans, pointNumber), [outcome]: lineup },
  };
}

/** Drop plans for points already played, so the object can't grow all game
 *  and a stale plan can't resurface if the point numbering moves. */
export function prunePlans(plans: PointPlans, throughPointNumber: number): PointPlans {
  const kept: PointPlans = {};
  for (const [key, drafts] of Object.entries(plans)) {
    if (Number(key) > throughPointNumber) kept[Number(key)] = drafts;
  }
  return kept;
}

/**
 * How many upcoming points the planner shows at once. Any number the coach
 * wants — some plan the next point, some map out a whole stretch.
 *
 * The upper bound isn't a design opinion, just a guard: a game can't run
 * forever, and a stuck "+" shouldn't be able to mount hundreds of rows.
 */
export const MIN_PLAN_DEPTH = 1;
export const MAX_PLAN_DEPTH = 25;
export const DEFAULT_PLAN_DEPTH = 3;

/** Keeps a depth in range, including when it arrives from stored state a
 *  previous version wrote. */
export function clampPlanDepth(depth: number): number {
  if (!Number.isFinite(depth)) return DEFAULT_PLAN_DEPTH;
  return Math.min(MAX_PLAN_DEPTH, Math.max(MIN_PLAN_DEPTH, Math.round(depth)));
}
