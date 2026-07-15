// A team's manager list (§4.0) — flat, many-to-many phone-number membership.
// Any existing manager can add/remove another; a team can never be left with
// zero managers (the server rejects removing the last one).

import type { TeamManager } from "@shared/game-rules";
import { api } from "../api/client";

export function readTeamManagers(teamId: string): Promise<TeamManager[]> {
  return api.get<TeamManager[]>(`/teams/${teamId}/managers`);
}

export function addTeamManager(teamId: string, phone: string): Promise<TeamManager[]> {
  return api.post<TeamManager[]>(`/teams/${teamId}/managers`, { phone });
}

export function removeTeamManager(teamId: string, phone: string): Promise<TeamManager[]> {
  return api.delete<TeamManager[]>(
    `/teams/${teamId}/managers/${encodeURIComponent(phone)}`,
  );
}
