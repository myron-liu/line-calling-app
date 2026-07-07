// Shared sideline display helpers for anything shaped like a player (team roster
// entries and per-game roster snapshots both have these fields). Kept in one
// place so every roster listing in the app (team page, check-in, line builder,
// lines/pods editor) sorts and renders players identically.

import type { GenderMatch, ODPreference, Role } from "@shared/game-rules";

/** Short role tag for the roster: H / C / H,C. */
export function roleTag(role: Role): string {
  return role === "handler" ? "H" : role === "cutter" ? "C" : "H,C";
}

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
