// Line validation — §8 "Line validation rules".
// Hard blocks return valid:false; soft warnings are surfaced separately so the UI
// can let the coach dismiss them.

import type { Division, GenderMatch, GenderRatio, Role } from "./types";
import { ratioCounts } from "./rules";

export const LINE_SIZE = 7;

export interface LineIssue {
  code:
    | "wrong_count"
    | "duplicate"
    | "ineligible"
    | "ratio_mmp"
    | "ratio_wmp";
  message: string;
}

/** Non-blocking nudges (§8). */
export interface LineWarning {
  code: "no_handler" | "time_imbalance";
  message: string;
}

export interface LinePlayer {
  id: string;
  genderMatch: GenderMatch;
  role: Role;
}

export interface ValidateLineParams {
  division: Division;
  /** Required ratio for the point; undefined for Open/Women. */
  requiredRatio?: GenderRatio;
  /** The selected players (resolved from ids). */
  players: LinePlayer[];
  /** Ids that are on the tournament roster and not injured. */
  eligiblePlayerIds: Set<string>;
}

export interface LineValidationResult {
  valid: boolean;
  issues: LineIssue[];
  mmp: number;
  wmp: number;
}

/**
 * Hard-block validation: exactly 7, no duplicates, all eligible, and (Mixed only)
 * the exact required ratio. Open/Women drop to "exactly 7 eligible".
 */
export function validateLine(params: ValidateLineParams): LineValidationResult {
  const { division, requiredRatio, players, eligiblePlayerIds } = params;
  const issues: LineIssue[] = [];

  const ids = players.map((p) => p.id);
  const uniqueIds = new Set(ids);

  if (uniqueIds.size !== ids.length) {
    issues.push({ code: "duplicate", message: "A player is listed twice." });
  }

  if (uniqueIds.size !== LINE_SIZE) {
    issues.push({
      code: "wrong_count",
      message: `A line needs exactly ${LINE_SIZE} players (have ${uniqueIds.size}).`,
    });
  }

  for (const p of players) {
    if (!eligiblePlayerIds.has(p.id)) {
      issues.push({
        code: "ineligible",
        message: "A selected player is injured or off the tournament roster.",
      });
      break;
    }
  }

  const mmp = players.filter((p) => p.genderMatch === "MMP").length;
  const wmp = players.filter((p) => p.genderMatch === "WMP").length;

  if (division === "mixed" && requiredRatio) {
    const need = ratioCounts(requiredRatio);
    if (mmp !== need.mmp) {
      issues.push({
        code: "ratio_mmp",
        message: `Need ${need.mmp} MMP on the field (have ${mmp}).`,
      });
    }
    if (wmp !== need.wmp) {
      issues.push({
        code: "ratio_wmp",
        message: `Need ${need.wmp} WMP on the field (have ${wmp}).`,
      });
    }
  }

  return { valid: issues.length === 0, mmp, wmp, issues };
}

/** Soft, dismissible warnings for an otherwise-valid line (§8). */
export function lineWarnings(params: {
  players: LinePlayer[];
  pointsPlayed: Record<string, number>;
  squadAveragePoints: number;
}): LineWarning[] {
  const warnings: LineWarning[] = [];

  const hasHandler = params.players.some(
    (p) => p.role === "handler" || p.role === "both",
  );
  if (!hasHandler) {
    warnings.push({ code: "no_handler", message: "No handler on this line." });
  }

  const overplayed = params.players.some(
    (p) => (params.pointsPlayed[p.id] ?? 0) > params.squadAveragePoints + 3,
  );
  if (overplayed) {
    warnings.push({
      code: "time_imbalance",
      message: "A player is well above the squad's average points played.",
    });
  }

  return warnings;
}
