"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Game, Player, Tournament } from "@shared/game-rules";
import { readPlayers, readTeam } from "@/lib/storage/teams";
import {
  applyPendingRosterChanges,
  findTournament,
  readPendingRosterChanges,
  readTournamentRoster,
  syncTournamentRoster,
  writePendingRosterChanges,
  type PendingRosterChange,
  type TournamentRosterEntry,
} from "@/lib/storage/tournaments";
import { listTournamentGames } from "@/lib/storage/games";
import { sortRoster } from "@/lib/player-display";
import { CreateGameForm } from "./create-game-form";
import { GameList } from "./team-detail";

const FLUSH_INTERVAL_MS = 30_000;

export function TournamentDetail({ tournamentId }: { tournamentId: string }) {
  const [tournament, setTournament] = useState<Tournament | null | undefined>(
    undefined,
  );
  const [teamName, setTeamName] = useState("Team");
  const [players, setPlayers] = useState<Player[]>([]);
  const [roster, setRoster] = useState<TournamentRosterEntry[]>([]);
  const [games, setGames] = useState<Game[]>([]);

  // Check-in taps are buffered here (and mirrored to localStorage) instead of
  // firing a request per click; a timer below flushes them in one batch.
  const pendingRef = useRef<Record<string, PendingRosterChange>>({});

  useEffect(() => {
    findTournament(tournamentId).then((t) => {
      setTournament(t);
      if (!t) return;
      readTeam(t.teamId).then((team) => setTeamName(team?.name ?? "Team"));
      readPlayers(t.teamId).then(setPlayers);
      readTournamentRoster(tournamentId).then((serverRoster) => {
        const pending = readPendingRosterChanges(tournamentId);
        pendingRef.current = pending;
        setRoster(applyPendingRosterChanges(serverRoster, pending));
      });
      listTournamentGames(tournamentId).then(setGames);
    });
  }, [tournamentId]);

  // Flush buffered taps periodically; skip entirely if nothing changed. On a
  // successful flush, just adopt whatever the server returns as the new
  // ground truth rather than trying to reconcile conflicts locally.
  useEffect(() => {
    const flush = async () => {
      const pending = pendingRef.current;
      const playerIds = Object.keys(pending);
      if (playerIds.length === 0) return;
      const changes = playerIds.map((playerId) => ({
        playerId,
        ...pending[playerId]!,
      }));
      try {
        const serverRoster = await syncTournamentRoster(tournamentId, changes);
        pendingRef.current = {};
        writePendingRosterChanges(tournamentId, {});
        setRoster(serverRoster);
      } catch (err) {
        // Offline or a transient error — leave the buffer intact and retry
        // on the next tick.
        console.error("[check-in] sync failed, will retry", err);
      }
    };
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      flush();
    };
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

  const buffer = (playerId: string, change: PendingRosterChange) => {
    pendingRef.current = { ...pendingRef.current, [playerId]: change };
    writePendingRosterChanges(tournamentId, pendingRef.current);
  };

  const setLocalPresent = (playerId: string, present: boolean) => {
    const injured = roster.find((r) => r.playerId === playerId)?.injured ?? false;
    buffer(playerId, { present, injured });
    setRoster((r) => {
      if (present) {
        if (r.some((e) => e.playerId === playerId)) return r;
        return [...r, { playerId, injured: false }];
      }
      return r.filter((e) => e.playerId !== playerId);
    });
  };

  const setLocalInjured = (playerId: string, injured: boolean) => {
    if (!presentIds.has(playerId)) return;
    buffer(playerId, { present: true, injured });
    setRoster((r) =>
      r.map((e) => (e.playerId === playerId ? { ...e, injured } : e)),
    );
  };

  const selectAll = () => {
    const absent = players.filter((p) => !presentIds.has(p.id));
    if (absent.length === 0) return;
    for (const p of absent) buffer(p.id, { present: true, injured: false });
    setRoster((r) => [
      ...r,
      ...absent.map((p) => ({ playerId: p.id, injured: false })),
    ]);
  };

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
            {tournament.division} ·{" "}
            {tournament.endDate && tournament.endDate !== tournament.startDate
              ? `${tournament.startDate} – ${tournament.endDate}`
              : tournament.startDate}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">
            Check-in{" "}
            <span className="text-faint">
              ({presentIds.size}/{players.length} present)
            </span>
          </h2>
          {players.length > 0 && presentIds.size < players.length && (
            <button
              onClick={selectAll}
              className="text-sm font-medium text-emerald-700 hover:opacity-80 dark:text-emerald-400"
            >
              Select all
            </button>
          )}
        </div>
        {players.length === 0 ? (
          <p className="text-sm text-muted">
            No players on the team roster yet.
          </p>
        ) : (
          <>
            <CheckInAccordion
              label="MMP"
              tone="sky"
              players={sortRoster(players.filter((p) => p.genderMatch === "MMP"))}
              presentIds={presentIds}
              injuredIds={injuredIds}
              onTogglePresent={setLocalPresent}
              onSetInjured={setLocalInjured}
            />
            <CheckInAccordion
              label="WMP"
              tone="rose"
              players={sortRoster(players.filter((p) => p.genderMatch === "WMP"))}
              presentIds={presentIds}
              injuredIds={injuredIds}
              onTogglePresent={setLocalPresent}
              onSetInjured={setLocalInjured}
            />
          </>
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
        <GameList
          games={games}
          emptyLabel="No games yet."
          tournamentStartDate={tournament.startDate}
          tournamentEndDate={tournament.endDate}
        />
        {canCreateGame ? (
          <CreateGameForm
            teamId={tournament.teamId}
            tournamentId={tournamentId}
            division={tournament.division}
            players={presentPlayers}
            injuredIds={injuredIds}
            selectable={false}
            tournamentStartDate={tournament.startDate}
            tournamentEndDate={tournament.endDate}
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

const CHECKIN_TONE = {
  sky: {
    border: "border-sky-200 dark:border-sky-500/30",
    text: "text-sky-600 dark:text-sky-400",
  },
  rose: {
    border: "border-rose-200 dark:border-rose-500/30",
    text: "text-rose-600 dark:text-rose-400",
  },
} as const;

function CheckInAccordion({
  label,
  tone,
  players,
  presentIds,
  injuredIds,
  onTogglePresent,
  onSetInjured,
}: {
  label: string;
  tone: keyof typeof CHECKIN_TONE;
  players: Player[];
  presentIds: Set<string>;
  injuredIds: Set<string>;
  onTogglePresent: (playerId: string, present: boolean) => void;
  onSetInjured: (playerId: string, injured: boolean) => void;
}) {
  const t = CHECKIN_TONE[tone];
  const presentCount = players.filter((p) => presentIds.has(p.id)).length;
  return (
    <details open className={`rounded-lg border p-2 ${t.border}`}>
      <summary className={`cursor-pointer text-sm font-semibold ${t.text}`}>
        {label}{" "}
        <span className="font-normal text-faint">
          ({presentCount}/{players.length})
        </span>
      </summary>
      <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
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
                  onChange={(e) => onTogglePresent(p.id, e.target.checked)}
                />
                <span className={t.text}>{p.genderMatch}</span>
                <span className={present ? "" : "text-faint"}>
                  {p.nickname || p.name}
                </span>
              </label>
              {present && (
                <select
                  value={injured ? "injured" : "healthy"}
                  onChange={(e) => onSetInjured(p.id, e.target.value === "injured")}
                  className={`rounded border px-1.5 py-0.5 text-xs ${
                    injured
                      ? "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-200"
                      : "border-line-strong text-faint"
                  }`}
                >
                  <option value="healthy">Healthy</option>
                  <option value="injured">Injured</option>
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
