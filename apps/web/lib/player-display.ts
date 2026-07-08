// Shared sideline display helpers for anything shaped like a player (team roster
// entries and per-game roster snapshots both have these fields). Kept in one
// place so every roster listing in the app (team page, check-in, line builder,
// lines/pods editor) sorts and renders players identically.

import type { GenderMatch, LineColor, ODPreference, Role } from "@shared/game-rules";

/** Short role tag for the roster: H / C / H,C. */
export function roleTag(role: Role): string {
  return role === "handler" ? "H" : role === "cutter" ? "C" : "H,C";
}

/** Per-role color for the roleTag badge — one distinct color per role so a
 *  line can be scanned at a glance for its H/C mix (§ live caller roster). */
export const ROLE_BADGE_COLOR: Record<Role, string> = {
  handler:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  cutter: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300",
  both: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
};

/** Short O/D-preference tag: O / D / O/D. Unset reads as flexible (O/D). */
export function odTag(od: ODPreference | undefined): string {
  return od === "O" ? "O" : od === "D" ? "D" : "O/D";
}

/** Sideline display name: nickname if set, else full name. */
export function displayName(p: { name: string; nickname?: string }): string {
  return p.nickname || p.name;
}

const GENDER_RANK: Record<GenderMatch, number> = { MMP: 0, WMP: 1 };
// O-preference first, then D, then flexible ("both"/unset) last — mirrors odTag.
const OD_RANK: Record<ODPreference, number> = { O: 0, D: 1, both: 2 };
// Handlers first, then Both, then Cutters — grouped for a quick scan when
// building a line.
const ROLE_RANK: Record<Role, number> = { handler: 0, both: 1, cutter: 2 };

type SortableRosterEntry = {
  genderMatch: GenderMatch;
  odPreference?: ODPreference;
  role: Role;
  name: string;
  nickname?: string;
};

/**
 * Canonical roster ordering used everywhere a player list is shown: gender,
 * then O/D preference, then role, then display name. Any of the first three
 * keys become a no-op when the list is already grouped by that field (e.g. a
 * single gender column), so this is safe to apply even after pre-filtering.
 */
export function sortRoster<T extends SortableRosterEntry>(players: T[]): T[] {
  return [...players].sort((a, b) => {
    const gender = GENDER_RANK[a.genderMatch] - GENDER_RANK[b.genderMatch];
    if (gender !== 0) return gender;
    const od = OD_RANK[a.odPreference ?? "both"] - OD_RANK[b.odPreference ?? "both"];
    if (od !== 0) return od;
    const role = ROLE_RANK[a.role] - ROLE_RANK[b.role];
    if (role !== 0) return role;
    return displayName(a).localeCompare(displayName(b));
  });
}

/** The 6 assignable saved-line/pod colors — shared by the lines editor's swatch
 *  picker and the live caller's quick-lines chips, so a color reads the same
 *  everywhere. */
export const LINE_COLORS: LineColor[] = [
  "red",
  "green",
  "blue",
  "yellow",
  "black",
  "purple",
];

/** Solid swatch background — used for the small picker dot in the editor. */
export const LINE_COLOR_SWATCH: Record<LineColor, string> = {
  red: "bg-red-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
  yellow: "bg-yellow-400",
  black: "bg-neutral-800 dark:bg-neutral-500",
  purple: "bg-purple-500",
};

/** Chip tone (border/background/text) for a saved-line/pod's assigned color —
 *  used by the live caller's quick-lines bar. Falls back to the default
 *  line/pod (emerald/violet) tone when no color is assigned. */
export const LINE_COLOR_CHIP: Record<LineColor, string> = {
  red: "border-red-300 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300",
  green:
    "border-green-300 bg-green-50 text-green-800 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-300",
  blue: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300",
  yellow:
    "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-500/40 dark:bg-yellow-500/10 dark:text-yellow-300",
  black:
    "border-neutral-400 bg-neutral-100 text-neutral-800 dark:border-neutral-500/40 dark:bg-neutral-500/10 dark:text-neutral-300",
  purple:
    "border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-500/40 dark:bg-purple-500/10 dark:text-purple-300",
};
