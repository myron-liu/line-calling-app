// Tournaments and their check-in roster (§4.2), persisted via the API server. A
// tournament draws a subset of the team roster; injury is the only availability
// lever. This is "setup" data (§13.12): online-only, no offline fallback.
// Checking a player in/out cascades to every game under the tournament — the
// server does that (see apps/server/src/db/queries.ts's syncTournamentGameRosters)
// as part of handling the presence PUT below.

import type { Division, Tournament } from "@shared/game-rules";
import { api } from "../api/client";

// ── Tournaments ──────────────────────────────────────────────────────────────

export function readTournaments(teamId: string): Promise<Tournament[]> {
  return api.get<Tournament[]>(`/teams/${teamId}/tournaments`);
}

export function findTournament(tournamentId: string): Promise<Tournament | null> {
  return api.get<Tournament>(`/tournaments/${tournamentId}`).catch((err) => {
    if (err.status === 404) return null;
    throw err;
  });
}

export function createTournament(
  teamId: string,
  name: string,
  division: Division,
  startDate: string,
): Promise<Tournament> {
  return api.post<Tournament>(`/teams/${teamId}/tournaments`, {
    name,
    division,
    startDate,
  });
}

// ── Check-in roster ────────────────────────────────────────────────────────────

/** A tournament roster is a plain list of present players + their injury flag. */
export interface TournamentRosterEntry {
  playerId: string;
  injured: boolean;
}

export function readTournamentRoster(
  tournamentId: string,
): Promise<TournamentRosterEntry[]> {
  return api.get<TournamentRosterEntry[]>(`/tournaments/${tournamentId}/roster`);
}

/** Add/remove a player from the check-in roster. Triggers the server-side
 *  cascade onto every game under this tournament. */
export function setPlayerPresent(
  tournamentId: string,
  playerId: string,
  present: boolean,
): Promise<void> {
  return api.put(`/tournaments/${tournamentId}/roster/${playerId}`, { present });
}

export function setPlayerInjured(
  tournamentId: string,
  playerId: string,
  injured: boolean,
): Promise<void> {
  return api.patch(`/tournaments/${tournamentId}/roster/${playerId}`, { injured });
}
