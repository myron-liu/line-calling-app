"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  Game,
  GenderMatch,
  OD,
  Point,
  PlayerPointOutcomes,
  PlayerStatTotals,
  PointEdit,
} from "@shared/game-rules";
import {
  DEFAULT_STRATEGY_TAGS,
  usedStrategyTags,
  defensiveEfficiency,
  efficiencyFromPlusMinus,
  emptyStatTotals,
  offensiveEfficiency,
  playerPointOutcomes,
  playerStatTotals,
  teamPointOutcomes,
} from "@shared/game-rules";
import { useLiveGame, type LiveGame } from "@/lib/game/useLiveGame";
import { readTeam } from "@/lib/storage/teams";
import { findTournament } from "@/lib/storage/tournaments";
import { displayName } from "@/lib/player-display";
import type { RosterSnapshotEntry } from "@/lib/storage/gameLog";
import { LiveCaller } from "./live-caller";
import { PointEditModal } from "./point-edit-modal";
import { StrategySummary } from "./live-caller";

// One route, three surfaces (§16). The live caller and recap key off the derived
// phase from the engine.
export function GameScreen({ gameId }: { gameId: string }) {
  const result = useLiveGame(gameId);

  if (result.status === "loading") {
    return <p className="text-muted">Loading game…</p>;
  }
  if (result.status === "not_found") {
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-muted">This game doesn’t exist on this device.</p>
        <Link href="/teams" className="text-sm text-emerald-700 dark:text-emerald-400 underline">
          Back to teams
        </Link>
      </div>
    );
  }

  const live = result.live;
  return (
    <div className="space-y-4">
      <BackLink game={live.game} />
      <SyncBar live={live} />
      {live.game.status === "scheduled" ? (
        <FlipResultForm live={live} />
      ) : live.state.phase === "completed" ? (
        <Recap live={live} />
      ) : (
        // awaiting_line + point_in_progress are both handled inside the caller.
        <LiveCaller live={live} />
      )}
    </div>
  );
}

// Gates entry into the live caller until the coach records what the coin flip
// actually decided — field side, team color, starting O/D, and (for mixed
// teams) which gender majority starts the first point are usually only known
// at that point, not at creation time (§ create-game-form).
function FlipResultForm({ live }: { live: LiveGame }) {
  const { game, actions } = live;
  const [isMixed, setIsMixed] = useState(false);
  const [fieldSide, setFieldSide] = useState<"left" | "right">("left");
  const [teamColor, setTeamColor] = useState<"light" | "dark">("light");
  const [startingOD, setStartingOD] = useState<OD>("O");
  const [manMajorityFirst, setManMajorityFirst] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readTeam(game.teamId)
      .then((team) => setIsMixed(team?.division === "mixed"))
      .catch(() => {});
  }, [game.teamId]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await actions.resolveFlip({
        fieldSide,
        teamColor,
        startingOD,
        startingGenderRatio: isMixed
          ? manMajorityFirst
            ? "4MMP_3WMP"
            : "4WMP_3MMP"
          : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">vs {game.opponentName}</h1>
        <p className="text-sm text-muted">
          What did the flip decide? This unlocks the live caller.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Field side (from home)</span>
          <select
            value={fieldSide}
            onChange={(e) => setFieldSide(e.target.value as "left" | "right")}
            className="rounded border border-line-strong px-3 py-2"
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Team color</span>
          <select
            value={teamColor}
            onChange={(e) => setTeamColor(e.target.value as "light" | "dark")}
            className="rounded border border-line-strong px-3 py-2"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className={isMixed ? "flex flex-col gap-1" : "col-span-2 flex flex-col gap-1"}>
          <span className="text-muted">Starting on</span>
          <select
            value={startingOD}
            onChange={(e) => setStartingOD(e.target.value as OD)}
            className="rounded border border-line-strong px-3 py-2"
          >
            <option value="O">Offense</option>
            <option value="D">Defense</option>
          </select>
        </label>
        {isMixed && (
          <label className="flex flex-col gap-1">
            <span className="text-muted">First point majority</span>
            <select
              value={manMajorityFirst ? "MMP" : "WMP"}
              onChange={(e) => setManMajorityFirst(e.target.value === "MMP")}
              className="rounded border border-line-strong px-3 py-2"
            >
              <option value="MMP">4 MMP / 3 WMP</option>
              <option value="WMP">4 WMP / 3 MMP</option>
            </select>
          </label>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        onClick={submit}
        disabled={submitting}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:bg-disabled"
      >
        {submitting ? "Starting…" : "Start game"}
      </button>
    </section>
  );
}

// Per-game sync indicator + manual resync. Automatic flushes happen on every
// commit; when the server turns out to be further along than our version, we
// don't block on it — we just refresh (briefly showing "Syncing…") and the
// coach sees a note if that discarded any of their unsynced local changes
// (see useLiveGame's adoptServerState). This bar mainly surfaces "offline"
// and gives a manual on-demand resync.
function SyncBar({ live }: { live: LiveGame }) {
  const { sync, actions } = live;

  const label = (() => {
    switch (sync.status) {
      case "syncing":
        return "Syncing…";
      case "offline":
        return "Offline — will retry automatically";
      default:
        return sync.lastSyncedAt
          ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "Not yet synced";
    }
  })();

  const tone =
    sync.status === "offline" ? "text-amber-600 dark:text-amber-400" : "text-faint";

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className={tone}>{label}</span>
      <button
        onClick={actions.resyncNow}
        disabled={sync.status === "syncing"}
        className="shrink-0 rounded border border-line-strong px-2 py-1 font-medium text-muted hover:text-fg disabled:opacity-50"
      >
        {sync.status === "syncing" ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}

// Contextual back link to the game's tournament (or team, for a standalone game).
function BackLink({ game }: { game: Game }) {
  const href = game.tournamentId
    ? `/tournaments/${game.tournamentId}`
    : `/teams/${game.teamId}`;
  const [label, setLabel] = useState("Back");

  useEffect(() => {
    // Best-effort: this is just a label, and the live game must not depend on
    // being online, so a fetch failure here silently keeps the "Back" fallback.
    if (game.tournamentId) {
      findTournament(game.tournamentId)
        .then((t) => setLabel(t ? t.name : "Tournament"))
        .catch(() => {});
    } else {
      readTeam(game.teamId)
        .then((team) => setLabel(team ? team.name : "Team"))
        .catch(() => {});
    }
  }, [game.tournamentId, game.teamId]);

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
    >
      <span aria-hidden>←</span> {label}
    </Link>
  );
}

function Recap({ live }: { live: LiveGame }) {
  const { game, state, points, roster, actions, canUndo, undoLabel } = live;
  const byId = useMemo(
    () => new Map(roster.map((p) => [p.playerId, p])),
    [roster],
  );
  const outcomes = useMemo(() => teamPointOutcomes(points), [points]);
  const playerOutcomes = useMemo(() => playerPointOutcomes(points), [points]);
  const statTotals = useMemo(() => playerStatTotals(points), [points]);

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Final · vs {game.opponentName}</h1>
        <span className="text-3xl font-bold tabular-nums">
          {state.ourScore}–{state.theirScore}
        </span>
      </div>
      <p className="text-sm text-muted">
        {state.ourScore > state.theirScore ? "Win" : state.ourScore < state.theirScore ? "Loss" : "Tie"}
        {" · "}
        {game.gameCap === null ? "time cap" : `${game.gameCap}-cap`}
      </p>

      {canUndo && (
        <button
          onClick={actions.undo}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
        >
          {undoLabel ?? "Undo"}
        </button>
      )}

      <OverallStats outcomes={outcomes} />

      <StrategySummary points={points} />

      <LineHistory points={points} byId={byId} onEditPoint={actions.editPoint} roster={roster} />

      <PointsPlayedTables
        isMixed={!!game.startingGenderRatio}
        roster={roster}
        pointsPlayed={state.pointsPlayed}
        playerOutcomes={playerOutcomes}
        statTotals={statTotals}
      />
    </section>
  );
}

// ── Overall stats ────────────────────────────────────────────────────────────

function OverallStats({
  outcomes,
}: {
  outcomes: { holds: number; broken: number; breaks: number; opponentHolds: number };
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-faint">
        Overall
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Holds" value={outcomes.holds} />
        <StatTile label="Broken" value={outcomes.broken} />
        <StatTile label="Breaks" value={outcomes.breaks} />
        <StatTile label="Opponent held" value={outcomes.opponentHolds} />
      </div>
      {/* Conversion rates off the same four counts. */}
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="O% (holds / O points)" value={formatPercent(offensiveEfficiency(outcomes))} />
        <StatTile label="D% (breaks / D points)" value={formatPercent(defensiveEfficiency(outcomes))} />
      </div>
    </div>
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

// ── Line history ─────────────────────────────────────────────────────────────

function LineHistory({
  points,
  byId,
  roster,
  onEditPoint,
}: {
  points: Point[];
  byId: Map<string, RosterSnapshotEntry>;
  roster: RosterSnapshotEntry[];
  onEditPoint: (pointId: string, edit: PointEdit) => void;
}) {
  const [editing, setEditing] = useState<Point | null>(null);
  const nameFor = (id: string) => {
    const p = byId.get(id);
    return p ? displayName(p) : id;
  };

  // Running score before/after each point, so each row can show its transition
  // (e.g. 0-0 -> 1-0).
  const transitions = useMemo(() => {
    let our = 0;
    let their = 0;
    return points.map((p) => {
      const before = { our, their };
      if (p.result === "us") our++;
      else if (p.result === "them") their++;
      return { before, after: { our, their } };
    });
  }, [points]);

  return (
    <details className="rounded-lg border border-line p-2">
      <summary className="cursor-pointer text-sm font-semibold">
        Line history <span className="font-normal text-faint">({points.length})</span>
      </summary>
      <ul className="mt-2 space-y-2">
        {points.map((p, i) => {
          const t = transitions[i]!;
          return (
          <li key={p.id} className="rounded-md border border-line p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Point {p.pointNumber}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-semibold text-white ${
                  p.od === "O" ? "bg-sky-600" : "bg-orange-600"
                }`}
              >
                {p.od}
              </span>
              {p.result && (
                <span
                  className={
                    p.result === "us"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-muted"
                  }
                >
                  {p.result === "us" ? "We scored" : "They scored"}
                </span>
              )}
              {p.result && (
                <span className="tabular-nums text-faint">
                  {t.before.our}-{t.before.their} → {t.after.our}-{t.after.their}
                </span>
              )}
              {p.result !== undefined && (
                <button
                  onClick={() => setEditing(p)}
                  className="ml-auto rounded-md border border-line-strong px-2 py-0.5 text-xs"
                >
                  Edit
                </button>
              )}
            </div>
            <p className="mt-1 text-faint">
              {p.lineup.map((id) => nameFor(id)).join(", ")}
            </p>
            <PointStatLine point={p} nameFor={nameFor} />
            {p.substitutions && p.substitutions.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {p.substitutions.map((s, si) => (
                  <li
                    key={si}
                    className="text-amber-700 dark:text-amber-300"
                  >
                    Injury: {nameFor(s.injuredPlayerId)} → {nameFor(s.replacementPlayerId)}
                  </li>
                ))}
              </ul>
            )}
          </li>
          );
        })}
      </ul>

      {editing && (
        <PointEditModal
          point={editing}
          roster={roster}
          strategyVocabulary={Array.from(
            new Set([...DEFAULT_STRATEGY_TAGS, ...usedStrategyTags(points)]),
          )}
          onClose={() => setEditing(null)}
          onSave={(edit) => {
            onEditPoint(editing.id, edit);
            setEditing(null);
          }}
        />
      )}
    </details>
  );
}

// ── Points-played tables ─────────────────────────────────────────────────────

type StatSortKey =
  | "name"
  | "count"
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

interface StatRow extends PlayerStatTotals {
  p: RosterSnapshotEntry;
  count: number;
  oPointsPlayed: number;
  dPointsPlayed: number;
  oPlusMinus: number;
  dPlusMinus: number;
}

/** Numeric value behind a sortable column. The two efficiencies are derived
 *  rather than stored, and a player with no points on that side sorts below
 *  an honest 0% instead of above it. */
function statValue(r: StatRow, key: Exclude<StatSortKey, "name">): number {
  if (key === "dEfficiency") {
    return efficiencyFromPlusMinus(r.dPointsPlayed, r.dPlusMinus) ?? -1;
  }
  if (key === "oEfficiency") {
    return efficiencyFromPlusMinus(r.oPointsPlayed, r.oPlusMinus) ?? -1;
  }
  return r[key];
}

function compareStatRows(a: StatRow, b: StatRow, sort: StatSort): number {
  if (sort.key === "name") {
    const cmp = displayName(a.p).localeCompare(displayName(b.p));
    return sort.dir === "asc" ? cmp : -cmp;
  }
  const diff =
    sort.dir === "asc"
      ? statValue(a, sort.key) - statValue(b, sort.key)
      : statValue(b, sort.key) - statValue(a, sort.key);
  return diff || displayName(a.p).localeCompare(displayName(b.p));
}

/** Every sortable stat column in display order, with the tooltip shown on
 *  hover — the headers are abbreviated hard to fit a phone, so the long name
 *  has to live somewhere. */
const STAT_COLUMNS: {
  key: Exclude<StatSortKey, "name">;
  label: string;
  hint: string;
}[] = [
  { key: "count", label: "Pts", hint: "Points played" },
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

function PointsPlayedTables({
  isMixed,
  roster,
  pointsPlayed,
  playerOutcomes,
  statTotals,
}: {
  /** Open and Women teams are single-gender by definition, so splitting the
   *  roster by genderMatch would just leave one table and one empty one. */
  isMixed: boolean;
  roster: RosterSnapshotEntry[];
  pointsPlayed: Record<string, number>;
  playerOutcomes: Record<string, PlayerPointOutcomes>;
  statTotals: Record<string, PlayerStatTotals>;
}) {
  const [sort, setSort] = useState<StatSort>({ key: "count", dir: "desc" });
  const onSort = (key: StatSortKey) => setSort((cur) => toggleStatSort(cur, key));
  const shared = { roster, pointsPlayed, playerOutcomes, statTotals, sort, onSort };

  if (!isMixed) {
    return <PointsPlayedTable gender={null} {...shared} />;
  }
  return (
    <div className="flex flex-wrap gap-3">
      <div className="min-w-[280px] flex-1">
        <PointsPlayedTable gender="MMP" {...shared} />
      </div>
      <div className="min-w-[280px] flex-1">
        <PointsPlayedTable gender="WMP" {...shared} />
      </div>
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

/** A hand-recorded count, dimmed at zero so real numbers stand out. */
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

/** Everything recorded by hand for one point (§ stats) — who scored it, plus
 *  each D and turnover. Renders nothing when nothing was recorded. */
function PointStatLine({
  point,
  nameFor,
}: {
  point: Point;
  nameFor: (id: string) => string;
}) {
  const events = point.statEvents ?? [];
  const s = point.scoring;
  if (!s && events.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      {s?.kind === "goal" && (
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
          {s.assistPlayerId ? `${nameFor(s.assistPlayerId)} → ` : ""}
          {nameFor(s.goalPlayerId)}
        </span>
      )}
      {s?.kind === "callahan" && (
        <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-800 dark:bg-violet-500/20 dark:text-violet-300">
          Callahan · {nameFor(s.playerId)}
        </span>
      )}
      {events.map((ev) => (
        <span
          key={ev.id}
          className={`rounded px-1.5 py-0.5 ${
            ev.type === "block"
              ? "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
          }`}
        >
          {ev.type === "block" ? "D" : "T"} · {nameFor(ev.playerId)}
        </span>
      ))}
    </p>
  );
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

function PointsPlayedTable({
  gender,
  roster,
  pointsPlayed,
  playerOutcomes,
  statTotals,
  sort,
  onSort,
}: {
  /** Null for a single-gender team: one table over the whole roster, headed
   *  "Player" rather than a genderMatch that carries no information. */
  gender: GenderMatch | null;
  roster: RosterSnapshotEntry[];
  pointsPlayed: Record<string, number>;
  playerOutcomes: Record<string, PlayerPointOutcomes>;
  statTotals: Record<string, PlayerStatTotals>;
  sort: StatSort;
  onSort: (key: StatSortKey) => void;
}) {
  const rows: StatRow[] = roster
    .filter((p) => gender === null || p.genderMatch === gender)
    .map((p) => {
      const o = playerOutcomes[p.playerId];
      return {
        p,
        count: pointsPlayed[p.playerId] ?? 0,
        oPointsPlayed: o?.oPointsPlayed ?? 0,
        dPointsPlayed: o?.dPointsPlayed ?? 0,
        oPlusMinus: o?.oPlusMinus ?? 0,
        dPlusMinus: o?.dPlusMinus ?? 0,
        ...(statTotals[p.playerId] ?? emptyStatTotals()),
      };
    })
    .sort((a, b) => compareStatRows(a, b, sort));

  const headerTone =
    gender === null
      ? undefined
      : gender === "MMP"
        ? "text-sky-600 dark:text-sky-400"
        : "text-rose-600 dark:text-rose-400";

  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <SortableTh
            label={gender ?? "Player"}
            sortKey="name"
            sort={sort}
            onSort={onSort}
            align="left"
            toneClassName={headerTone}
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
        {rows.map((row) => {
          const { p, count, oPointsPlayed, dPointsPlayed, oPlusMinus, dPlusMinus } = row;
          return (
          <tr key={p.playerId}>
            <td className="border-b border-line py-1">{displayName(p)}</td>
            <NumCell>{count}</NumCell>
            <NumCell>{dPointsPlayed}</NumCell>
            <NumCell>{formatPlusMinus(dPlusMinus)}</NumCell>
            <NumCell>
              {formatPercent(efficiencyFromPlusMinus(dPointsPlayed, dPlusMinus))}
            </NumCell>
            <NumCell>{oPointsPlayed}</NumCell>
            <NumCell>{formatPlusMinus(oPlusMinus)}</NumCell>
            <NumCell>
              {formatPercent(efficiencyFromPlusMinus(oPointsPlayed, oPlusMinus))}
            </NumCell>
            <StatCell value={row.assists} />
            <StatCell value={row.goals} />
            <StatCell value={row.blocks} />
            <StatCell value={row.turnovers} />
            <StatCell value={row.callahans} />
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}
