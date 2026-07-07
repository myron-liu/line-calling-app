// Shared sideline display helpers for anything shaped like a player (team roster
// entries and per-game roster snapshots both have these fields). Kept in one
// place so the live caller and the lines/pods editor render players identically.

import type { ODPreference, Role } from "@shared/game-rules";

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

// Handlers first, then Both, then Cutters — grouped for a quick scan when
// building a line. Stable sort preserves roster order within each group.
const ROLE_RANK: Record<Role, number> = {
  handler: 0,
  both: 1,
  cutter: 2,
};
export function sortByRole<T extends { role: Role }>(players: T[]): T[] {
  return [...players].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);
}
