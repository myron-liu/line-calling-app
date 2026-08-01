"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  defensiveEfficiency,
  efficiencyFromPlusMinus,
  offensiveEfficiency,
  type Tournament,
} from "@shared/game-rules";
import { findTournament } from "@/lib/storage/tournaments";
import {
  readTournamentStats,
  type TournamentPlayerStats,
  type TournamentStats as TournamentStatsData,
} from "@/lib/storage/tournaments";
import { displayName } from "@/lib/player-display";

type StatSortKey =
  | "name"
  | "pointsPlayed"
  | "dPointsPlayed"
  | "dPlusMinus"
  | "oPointsPlayed"
  | "oPlusMinus"
  | "dEfficiency"
  | "oEfficiency"
  | "assists"
  | "goals"
  | "blocks"
  | "turnovers"
  | "callahans";

interface StatSort {
  key: StatSortKey;
  dir: "asc" | "desc";
}

function toggleStatSort(cur: StatSort, key: StatSortKey): StatSort {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" ? "asc" : "desc" };
}

/** Numeric value behind a sortable column. The two efficiencies are derived
 *  rather than stored, and a player with no points on that side sorts below
 *  an honest 0% instead of above it. */
function statValue(r: TournamentPlayerStats, key: Exclude<StatSortKey, "name">): number {
  if (key === "dEfficiency") {
    return efficiencyFromPlusMinus(r.dPointsPlayed, r.dPlusMinus) ?? -1;
  }
  if (key === "oEfficiency") {
    return efficiencyFromPlusMinus(r.oPointsPlayed, r.oPlusMinus) ?? -1;
  }
  return r[key];
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
  const av = statValue(a, sort.key);
  const bv = statValue(b, sort.key);
  const diff = sort.dir === "asc" ? av - bv : bv - av;
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
        {/* Conversion rates off the same four counts: what share of the
            points we started on O we held, and of those started on D we
            broke. */}
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="O% (holds / O points)" value={formatPercent(offensiveEfficiency(stats))} />
          <StatTile label="D% (breaks / D points)" value={formatPercent(defensiveEfficiency(stats))} />
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

function StatTile({ label, value }: { label: string; value: number | string }) {
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

/** A dash rather than "0%" when no points of that kind have been played —
 *  see offensiveEfficiency for why the distinction matters. */
function formatPercent(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
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
  hint,
}: {
  label: string;
  sortKey: StatSortKey;
  sort: StatSort;
  onSort: (key: StatSortKey) => void;
  align: "left" | "right";
  toneClassName?: string;
  /** Spelled-out column name, shown on hover and to screen readers. */
  hint?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`whitespace-nowrap border-b border-line pb-1 ${align === "right" ? "text-right" : "text-left"} text-xs font-semibold uppercase tracking-wide ${toneClassName ?? "text-faint"}`}
    >
      <button
        onClick={() => onSort(sortKey)}
        title={hint}
        aria-label={hint ? `${hint} — sort` : undefined}
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

/** Every sortable stat column in display order, with the tooltip shown on
 *  hover — the headers are abbreviated hard to fit a phone, so the long name
 *  has to live somewhere. */
const STAT_COLUMNS: {
  key: Exclude<StatSortKey, "name">;
  label: string;
  hint: string;
}[] = [
  { key: "pointsPlayed", label: "Pts", hint: "Points played" },
  { key: "dPointsPlayed", label: "D Pts", hint: "D points played" },
  { key: "dPlusMinus", label: "D +/-", hint: "D plus/minus" },
  {
    key: "dEfficiency",
    label: "D%",
    hint: "Defensive efficiency — share of their D points won",
  },
  { key: "oPointsPlayed", label: "O Pts", hint: "O points played" },
  { key: "oPlusMinus", label: "O +/-", hint: "O plus/minus" },
  {
    key: "oEfficiency",
    label: "O%",
    hint: "Offensive efficiency — share of their O points won",
  },
  { key: "assists", label: "A", hint: "Assists" },
  { key: "goals", label: "G", hint: "Goals" },
  { key: "blocks", label: "D", hint: "Defensive blocks" },
  { key: "turnovers", label: "T", hint: "Turnovers" },
  { key: "callahans", label: "C", hint: "Callahans" },
];

function NumCell({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b border-line py-1 text-right tabular-nums text-muted">
      {children}
    </td>
  );
}

/** A hand-recorded count. Zeros are dimmed further so the numbers that were
 *  actually recorded stand out in a table that's mostly zeros early on. */
function StatCell({ value }: { value: number }) {
  return (
    <td
      className={`border-b border-line py-1 text-right tabular-nums ${
        value === 0 ? "text-faint" : "text-fg"
      }`}
    >
      {value}
    </td>
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
          {STAT_COLUMNS.map((c) => (
            <SortableTh
              key={c.key}
              label={c.label}
              hint={c.hint}
              sortKey={c.key}
              sort={sort}
              onSort={onSort}
              align="right"
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.playerId}>
            <td className="border-b border-line py-1">{displayName(p)}</td>
            <NumCell>{p.pointsPlayed}</NumCell>
            <NumCell>{p.dPointsPlayed}</NumCell>
            <NumCell>{formatPlusMinus(p.dPlusMinus)}</NumCell>
            <NumCell>
              {formatPercent(efficiencyFromPlusMinus(p.dPointsPlayed, p.dPlusMinus))}
            </NumCell>
            <NumCell>{p.oPointsPlayed}</NumCell>
            <NumCell>{formatPlusMinus(p.oPlusMinus)}</NumCell>
            <NumCell>
              {formatPercent(efficiencyFromPlusMinus(p.oPointsPlayed, p.oPlusMinus))}
            </NumCell>
            <StatCell value={p.assists} />
            <StatCell value={p.goals} />
            <StatCell value={p.blocks} />
            <StatCell value={p.turnovers} />
            <StatCell value={p.callahans} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
