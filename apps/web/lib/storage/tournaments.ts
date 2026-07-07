// Tournaments and their check-in roster (§4.2), persisted via the API server. A
// tournament draws a subset of the team roster; injury is the only availability
// lever.
//
// Check-in itself is *not* one request per tap: the coach may be tapping through
// a whole roster quickly (or hitting "Select all"), so present/injured taps are
// buffered in localStorage and flushed to the server in one batch periodically
// (see tournament-detail.tsx) rather than round-tripping on every click.
// Checking players in/out still cascades to every game under the tournament —
// the server does that once per flush (see queries.ts's syncTournamentGameRosters).

import type { Division, Tournament } from "@shared/game-rules";
import { api } from "../api/client";
import { keys } from "./keys";
import { read, write } from "./store";

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

/** A locally-buffered check-in tap not yet flushed to the server. Always
 *  carries both fields (not a partial patch) so there's no ambiguity about
 *  what to do with the field the tap didn't touch. */
export interface PendingRosterChange {
  present: boolean;
  injured: boolean;
}

export function readPendingRosterChanges(
  tournamentId: string,
): Record<string, PendingRosterChange> {
  return read(keys.tournamentRosterPending(tournamentId), {});
}

export function writePendingRosterChanges(
  tournamentId: string,
  pending: Record<string, PendingRosterChange>,
): void {
  write(keys.tournamentRosterPending(tournamentId), pending);
}

/** Overlay locally-buffered taps onto the last-known server roster, so a
 *  reload before the next flush doesn't lose unsynced check-in changes. */
export function applyPendingRosterChanges(
  serverRoster: TournamentRosterEntry[],
  pending: Record<string, PendingRosterChange>,
): TournamentRosterEntry[] {
  const byId = new Map(serverRoster.map((r) => [r.playerId, r]));
  for (const [playerId, change] of Object.entries(pending)) {
    if (change.present) byId.set(playerId, { playerId, injured: change.injured });
    else byId.delete(playerId);
  }
  return [...byId.values()];
}

/** Flush a batch of check-in changes. The server applies them, re-syncs every
 *  game under the tournament once, and returns the resulting roster — the
 *  caller should just adopt that as the new ground truth rather than trying
 *  to reconcile conflicts itself. */
export function syncTournamentRoster(
  tournamentId: string,
  changes: Array<{ playerId: string } & PendingRosterChange>,
): Promise<TournamentRosterEntry[]> {
  return api.put<TournamentRosterEntry[]>(`/tournaments/${tournamentId}/roster`, {
    changes,
  });
}
