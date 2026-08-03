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
