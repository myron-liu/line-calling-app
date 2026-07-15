// Teams and their players (§4.1), persisted via the API server. Every route is
// gated by phone-auth + team membership (§4.0, see lib/storage/managers.ts) —
// `readTeams` returns only the teams the signed-in phone manages. This is
// "setup" data (§13.12): online-only, no offline fallback.

import type {
  Division,
  GenderMatch,
  ODPreference,
  Player,
  Role,
  Team,
} from "@shared/game-rules";
import { api } from "../api/client";

// ── Teams ──────────────────────────────────────────────────────────────────────

export function readTeams(): Promise<Team[]> {
  return api.get<Team[]>("/teams");
}

export function readTeam(teamId: string): Promise<Team | null> {
  return api.get<Team>(`/teams/${teamId}`).catch((err) => {
    if (err.status === 404) return null;
    throw err;
  });
}

export function createTeam(name: string, division: Division): Promise<Team> {
  return api.post<Team>("/teams", { name, division });
}

// ── Players (the team roster) ────────────────────────────────────────────────────

export function readPlayers(teamId: string): Promise<Player[]> {
  return api.get<Player[]>(`/teams/${teamId}/players`);
}

export interface PlayerInput {
  name: string;
  nickname?: string;
  genderMatch: GenderMatch;
  role: Role;
  odPreference?: ODPreference;
  jerseyNumber?: number;
}

const norm = (s: string | undefined): string => (s ?? "").trim().toLowerCase();

/**
 * Returns a human-readable reason the player can't be added/renamed, or null if
 * unique within the team. Enforces distinct names and distinct nicknames, plus a
 * distinct *display label* (nickname || name) so no two players read the same on
 * the sideline. Case-insensitive. Pass `excludeId` when editing an existing player.
 *
 * Pure — takes the already-loaded roster instead of fetching, so it can run on
 * every keystroke without a network round-trip.
 */
export function playerConflict(
  players: Player[],
  input: { name: string; nickname?: string },
  excludeId?: string,
): string | null {
  const name = norm(input.name);
  const nick = norm(input.nickname);
  const label = nick || name;
  for (const p of players) {
    if (p.id === excludeId) continue;
    const pName = norm(p.name);
    const pNick = norm(p.nickname);
    const pLabel = pNick || pName;
    if (name && pName === name) {
      return `A player named “${p.name}” is already on the roster.`;
    }
    if (nick && pNick === nick) {
      return `The nickname “${input.nickname}” is already taken by ${p.name}.`;
    }
    if (label && pLabel === label) {
      return `“${input.nickname || input.name}” would read the same as ${p.name} on the sideline.`;
    }
  }
  return null;
}

export function createPlayer(teamId: string, input: PlayerInput): Promise<Player> {
  return api.post<Player>(`/teams/${teamId}/players`, input);
}

export function updatePlayer(
  playerId: string,
  patch: Partial<PlayerInput>,
): Promise<Player> {
  return api.patch<Player>(`/players/${playerId}`, patch);
}

export function deletePlayer(playerId: string): Promise<void> {
  return api.delete(`/players/${playerId}`);
}
