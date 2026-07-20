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

type StatSortKey =
  | "name"
  | "pointsPlayed"
  | "dPointsPlayed"
  | "dPlusMinus"
  | "oPointsPlayed"
  | "oPlusMinus";

interface StatSort {
  key: StatSortKey;
  dir: "asc" | "desc";
}

function toggleStatSort(cur: StatSort, key: StatSortKey): StatSort {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" ? "asc" : "desc" };
}

function compareStatRows(
  a: TournamentPlayerStats,
  b: TournamentPlayerStats,
  sort: StatSort,
): number {
  if (sort.key === "name") {
    const cmp = displayName(a).localeCompare(displayName(b));
    return sort.dir === "asc" ? cmp : -cmp;
  }
  const diff = sort.dir === "asc" ? a[sort.key] - b[sort.key] : b[sort.key] - a[sort.key];
  return diff || displayName(a).localeCompare(displayName(b));
}

// Aggregated points-played/+/- stats across every game in the tournament,
// reached from the tournament page. Overall holds/breaks come from
// getTournamentStats summing each game's completed points server-side.
export function TournamentStats({ tournamentId }: { tournamentId: string }) {
  const [tournament, setTournament] = useState<Tournament | null | undefined>(
    undefined,
  );
  const [stats, setStats] = useState<TournamentStatsData | null>(null);
  const [sort, setSort] = useState<StatSort>({ key: "pointsPlayed", dir: "desc" });
  const onSort = (key: StatSortKey) => setSort((cur) => toggleStatSort(cur, key));

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
        {stats.players.length === 0 ? (
          <p className="text-sm text-muted">No completed points yet.</p>
        ) : isMixed ? (
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[280px] flex-1">
              <PlayerStatsTable
                label="MMP"
                tone="sky"
                players={stats.players.filter((p) => p.genderMatch === "MMP")}
                sort={sort}
                onSort={onSort}
              />
            </div>
            <div className="min-w-[280px] flex-1">
              <PlayerStatsTable
                label="WMP"
                tone="rose"
                players={stats.players.filter((p) => p.genderMatch === "WMP")}
                sort={sort}
                onSort={onSort}
              />
            </div>
          </div>
        ) : (
          <PlayerStatsTable
            tone={tournament.division === "open" ? "sky" : "rose"}
            players={stats.players}
            sort={sort}
            onSort={onSort}
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

function formatPlusMinus(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** Column header that sorts its column on click, toggling asc/desc on repeat
 *  clicks, with a ▲/▼ indicator on whichever column is currently active. */
function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  align,
  toneClassName,
}: {
  label: string;
  sortKey: StatSortKey;
  sort: StatSort;
  onSort: (key: StatSortKey) => void;
  align: "left" | "right";
  toneClassName?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`whitespace-nowrap border-b border-line pb-1 ${align === "right" ? "text-right" : "text-left"} text-xs font-semibold uppercase tracking-wide ${toneClassName ?? "text-faint"}`}
    >
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-fg ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-fg" : ""}`}
      >
        <span>{label}</span>
        {active && <span aria-hidden>{sort.dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function PlayerStatsTable({
  label,
  tone,
  players,
  sort,
  onSort,
}: {
  /** Omitted for a single-division tournament, where MMP/WMP is redundant. */
  label?: string;
  tone: "sky" | "rose";
  players: TournamentPlayerStats[];
  sort: StatSort;
  onSort: (key: StatSortKey) => void;
}) {
  const rows = [...players].sort((a, b) => compareStatRows(a, b, sort));

  const headerTone = tone === "sky" ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400";

  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <SortableTh
            label={label ?? "Player"}
            sortKey="name"
            sort={sort}
            onSort={onSort}
            align="left"
            toneClassName={label ? headerTone : undefined}
          />
          <SortableTh label="Pts" sortKey="pointsPlayed" sort={sort} onSort={onSort} align="right" />
          <SortableTh label="D Pts" sortKey="dPointsPlayed" sort={sort} onSort={onSort} align="right" />
          <SortableTh label="D +/-" sortKey="dPlusMinus" sort={sort} onSort={onSort} align="right" />
          <SortableTh label="O Pts" sortKey="oPointsPlayed" sort={sort} onSort={onSort} align="right" />
          <SortableTh label="O +/-" sortKey="oPlusMinus" sort={sort} onSort={onSort} align="right" />
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
              {p.oPointsPlayed}
            </td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {formatPlusMinus(p.oPlusMinus)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
