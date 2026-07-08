// Saved lines / pods (§4.3), team-scoped, persisted via the API server. A saved
// line is a reusable group of 1..7 players (a full line or a partial pod);
// applying one just pre-selects those players in the line builder — validation
// still decides confirm.
//
// Setup screens (lines-editor) are online-only like the rest of §13.12. But the
// live caller's quick-lines bar reads this list too, so `listSavedLines` keeps a
// local read-through cache: a fetch failure (offline sideline) falls back to
// whatever was last fetched instead of leaving the quick-lines bar empty.

import type { LineColor, ODPreference, SavedLine } from "@shared/game-rules";
import { api } from "../api/client";
import { keys } from "./keys";
import { read, write } from "./store";

export async function readSavedLines(teamId: string): Promise<SavedLine[]> {
  try {
    const lines = await api.get<SavedLine[]>(`/teams/${teamId}/saved-lines`);
    write(keys.savedLines(teamId), lines);
    return lines;
  } catch {
    return read<SavedLine[]>(keys.savedLines(teamId), []);
  }
}

export function createSavedLine(
  teamId: string,
  name: string,
  playerIds: string[],
  options?: { color?: LineColor | null; side?: ODPreference | null },
): Promise<SavedLine> {
  return api.post<SavedLine>(`/teams/${teamId}/saved-lines`, {
    name,
    playerIds,
    ...options,
  });
}

export function updateSavedLine(
  id: string,
  patch: {
    name?: string;
    playerIds?: string[];
    color?: LineColor | null;
    side?: ODPreference | null;
  },
): Promise<SavedLine> {
  return api.patch<SavedLine>(`/saved-lines/${id}`, patch);
}

/** Bump a line/pod's usage counter — called when it's actually applied to a
 *  live line, not merely created or edited. */
export function incrementLineUsage(id: string): Promise<SavedLine> {
  return api.post<SavedLine>(`/saved-lines/${id}/use`);
}

export function deleteSavedLine(id: string): Promise<void> {
  return api.delete(`/saved-lines/${id}`);
}
