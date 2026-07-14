"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Tournament } from "@shared/game-rules";
import { findTournament } from "@/lib/storage/tournaments";
import {
  readTournamentStats,
  type TournamentPlayerStats,
  type TournamentStats as TournamentStatsData,
} from "@/lib/storage/tournaments";
import { displayName, roleTag } from "@/lib/player-display";

type StatSortMode = "points" | "dPlusMinus" | "oPlusMinus";

// Aggregated points-played/+/- stats across every game in the tournament,
// reached from the tournament page. Overall holds/breaks come from
// getTournamentStats summing each game's completed points server-side.
export function TournamentStats({ tournamentId }: { tournamentId: string }) {
  const [tournament, setTournament] = useState<Tournament | null | undefined>(
    undefined,
  );
  const [stats, setStats] = useState<TournamentStatsData | null>(null);
  const [sortMode, setSortMode] = useState<StatSortMode>("points");

  useEffect(() => {
    findTournament(tournamentId).then((t) => {
      setTournament(t);
      if (!t) return;
      readTournamentStats(tournamentId).then(setStats);
    });
  }, [tournamentId]);

  if (tournament === undefined) {
    return <p className="text-muted">Loading…</p>;
  }
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
  if (stats === null) {
    return <p className="text-muted">Loading…</p>;
  }

  const isMixed = tournament.division === "mixed";

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/tournaments/${tournamentId}`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
        >
          <span aria-hidden>←</span> {tournament.name}
        </Link>
        <h1 className="text-xl font-semibold">Stats</h1>
        <p className="text-sm text-muted">
          Aggregated across every game in the tournament.
        </p>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">
          Overall
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Holds" value={stats.holds} />
          <StatTile label="Broken" value={stats.broken} />
          <StatTile label="Breaks" value={stats.breaks} />
          <StatTile label="Opponent held" value={stats.opponentHolds} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-faint">Sort:</span>
          <SortButton
            label="Points"
            active={sortMode === "points"}
            onClick={() => setSortMode("points")}
          />
          <SortButton
            label="D +/-"
            active={sortMode === "dPlusMinus"}
            onClick={() => setSortMode("dPlusMinus")}
          />
          <SortButton
            label="O +/-"
            active={sortMode === "oPlusMinus"}
            onClick={() => setSortMode("oPlusMinus")}
          />
        </div>

        {stats.players.length === 0 ? (
          <p className="text-sm text-muted">No completed points yet.</p>
        ) : isMixed ? (
          <div className="grid grid-cols-2 gap-3">
            <PlayerStatsTable
              label="MMP"
              tone="sky"
              players={stats.players.filter((p) => p.genderMatch === "MMP")}
              sortMode={sortMode}
            />
            <PlayerStatsTable
              label="WMP"
              tone="rose"
              players={stats.players.filter((p) => p.genderMatch === "WMP")}
              sortMode={sortMode}
            />
          </div>
        ) : (
          <PlayerStatsTable
            tone={tournament.division === "open" ? "sky" : "rose"}
            players={stats.players}
            sortMode={sortMode}
          />
        )}
      </div>
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line p-2 text-center">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-faint">{label}</p>
    </div>
  );
}

function SortButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2 py-0.5 ${
        active
          ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-line-strong text-faint"
      }`}
    >
      {label}
    </button>
  );
}

function formatPlusMinus(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function formatOnOffDiff(n: number | null): string {
  if (n === null) return "—";
  const rounded = Math.round(n * 100) / 100;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function PlayerStatsTable({
  label,
  tone,
  players,
  sortMode,
}: {
  /** Omitted for a single-division tournament, where MMP/WMP is redundant. */
  label?: string;
  tone: "sky" | "rose";
  players: TournamentPlayerStats[];
  sortMode: StatSortMode;
}) {
  const rows = [...players].sort((a, b) => {
    const diff =
      sortMode === "points"
        ? b.pointsPlayed - a.pointsPlayed
        : sortMode === "dPlusMinus"
          ? b.dPlusMinus - a.dPlusMinus
          : b.oPlusMinus - a.oPlusMinus;
    return diff || displayName(a).localeCompare(displayName(b));
  });

  const headerTone = tone === "sky" ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400";

  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th
            className={`border-b border-line pb-1 text-left text-xs font-semibold uppercase tracking-wide ${
              label ? headerTone : "text-faint"
            }`}
          >
            {label ?? "Player"}
          </th>
          <th className="border-b border-line pb-1 text-right text-xs font-semibold uppercase tracking-wide text-faint">
            Pts
          </th>
          <th className="border-b border-line pb-1 text-right text-xs font-semibold uppercase tracking-wide text-faint">
            D Pts
          </th>
          <th className="border-b border-line pb-1 text-right text-xs font-semibold uppercase tracking-wide text-faint">
            D +/-
          </th>
          <th className="border-b border-line pb-1 text-right text-xs font-semibold uppercase tracking-wide text-faint">
            D On/Off
          </th>
          <th className="border-b border-line pb-1 text-right text-xs font-semibold uppercase tracking-wide text-faint">
            O Pts
          </th>
          <th className="border-b border-line pb-1 text-right text-xs font-semibold uppercase tracking-wide text-faint">
            O +/-
          </th>
          <th className="border-b border-line pb-1 text-right text-xs font-semibold uppercase tracking-wide text-faint">
            O On/Off
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.playerId}>
            <td className="border-b border-line py-1">
              <span className="mr-1 shrink-0 rounded bg-surface-2 px-1 text-[10px] font-medium text-muted">
                {roleTag(p.role)}
              </span>
              {displayName(p)}
            </td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {p.pointsPlayed}
            </td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {p.dPointsPlayed}
            </td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {formatPlusMinus(p.dPlusMinus)}
            </td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {formatOnOffDiff(p.dOnOffDiff)}
            </td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {p.oPointsPlayed}
            </td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {formatPlusMinus(p.oPlusMinus)}
            </td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {formatOnOffDiff(p.oOnOffDiff)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
