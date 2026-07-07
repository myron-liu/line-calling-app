"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Game, Player, Tournament } from "@shared/game-rules";
import { readPlayers, readTeam } from "@/lib/storage/teams";
import {
  findTournament,
  readTournamentRoster,
  setPlayerInjured,
  setPlayerPresent,
  type TournamentRosterEntry,
} from "@/lib/storage/tournaments";
import { listTournamentGames } from "@/lib/storage/games";
import { CreateGameForm } from "./create-game-form";
import { GameList } from "./team-detail";

export function TournamentDetail({ tournamentId }: { tournamentId: string }) {
  const [tournament, setTournament] = useState<Tournament | null | undefined>(
    undefined,
  );
  const [teamName, setTeamName] = useState("Team");
  const [players, setPlayers] = useState<Player[]>([]);
  const [roster, setRoster] = useState<TournamentRosterEntry[]>([]);
  const [games, setGames] = useState<Game[]>([]);

  useEffect(() => {
    findTournament(tournamentId).then((t) => {
      setTournament(t);
      if (!t) return;
      readTeam(t.teamId).then((team) => setTeamName(team?.name ?? "Team"));
      readPlayers(t.teamId).then(setPlayers);
      readTournamentRoster(tournamentId).then(setRoster);
      listTournamentGames(tournamentId).then(setGames);
    });
  }, [tournamentId]);

  if (tournament === undefined) return <p className="text-muted">Loading…</p>;
  if (tournament === null) {
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-muted">Tournament not found.</p>
        <Link href="/teams" className="text-sm text-emerald-700 dark:text-emerald-400 underline">
          Back to teams
        </Link>
      </div>
    );
  }

  const presentIds = new Set(roster.map((r) => r.playerId));
  const injuredIds = new Set(roster.filter((r) => r.injured).map((r) => r.playerId));
  const presentPlayers = players.filter((p) => presentIds.has(p.id));

  // Mixed needs enough of each gender checked in to fill every ABBA ratio (4/3);
  // Open/Women just need a full line's worth of eligible players.
  const isMixed = tournament.division === "mixed";
  const mmpCount = presentPlayers.filter((p) => p.genderMatch === "MMP").length;
  const wmpCount = presentPlayers.filter((p) => p.genderMatch === "WMP").length;
  const canCreateGame = isMixed
    ? mmpCount >= 4 && wmpCount >= 4
    : presentPlayers.length >= 7;

  const refreshRoster = () => readTournamentRoster(tournamentId).then(setRoster);

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <Link
          href={`/teams/${tournament.teamId}`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
        >
          <span aria-hidden>←</span> {teamName}
        </Link>
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">{tournament.name}</h1>
          <span className="text-xs uppercase tracking-wide text-faint">
            {tournament.division} · {tournament.startDate}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-medium">
          Check-in{" "}
          <span className="text-faint">
            ({presentIds.size}/{players.length} present)
          </span>
        </h2>
        {players.length === 0 ? (
          <p className="text-sm text-muted">
            No players on the team roster yet.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {players.map((p) => {
              const present = presentIds.has(p.id);
              const injured = injuredIds.has(p.id);
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-md border border-line px-2.5 py-1.5 text-sm"
                >
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={present}
                      onChange={(e) => {
                        // The server cascades this onto every game under the
                        // tournament (new players become eligible; removed
                        // players are locked out — past line history untouched).
                        setPlayerPresent(tournamentId, p.id, e.target.checked).then(
                          refreshRoster,
                        );
                      }}
                    />
                    <span
                      className={
                        p.genderMatch === "MMP" ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"
                      }
                    >
                      {p.genderMatch}
                    </span>
                    <span className={present ? "" : "text-faint"}>
                      {p.nickname || p.name}
                    </span>
                  </label>
                  {present && (
                    <button
                      onClick={() => {
                        setPlayerInjured(tournamentId, p.id, !injured).then(
                          refreshRoster,
                        );
                      }}
                      className={`rounded px-2 py-0.5 text-xs ${
                        injured
                          ? "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200"
                          : "text-faint hover:text-amber-700 dark:text-amber-300"
                      }`}
                    >
                      {injured ? "Injured" : "Healthy"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Games</h2>
          <Link
            href={`/tournaments/${tournamentId}/lines`}
            className="text-sm font-medium text-emerald-700 dark:text-emerald-400"
          >
            Lines &amp; pods →
          </Link>
        </div>
        <GameList games={games} emptyLabel="No games yet." />
        {canCreateGame ? (
          <CreateGameForm
            teamId={tournament.teamId}
            tournamentId={tournamentId}
            division={tournament.division}
            players={presentPlayers}
            injuredIds={injuredIds}
            selectable={false}
          />
        ) : (
          <p className="text-sm text-muted">
            {isMixed
              ? `Check in at least 4 MMP and 4 WMP to create a game (have ${mmpCount} MMP, ${wmpCount} WMP).`
              : "Check in at least 7 players to create a game."}
          </p>
        )}
      </div>
    </section>
  );
}
