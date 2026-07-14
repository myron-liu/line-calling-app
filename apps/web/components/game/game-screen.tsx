"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Game, GenderMatch, OD, Point, PlayerPointOutcomes } from "@shared/game-rules";
import { playerPointOutcomes, teamPointOutcomes } from "@shared/game-rules";
import { useLiveGame, type LiveGame } from "@/lib/game/useLiveGame";
import { readTeam } from "@/lib/storage/teams";
import { findTournament } from "@/lib/storage/tournaments";
import { displayName } from "@/lib/player-display";
import type { RosterSnapshotEntry } from "@/lib/storage/gameLog";
import { LiveCaller } from "./live-caller";

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

      <LineHistory points={points} byId={byId} />

      <PointsPlayedTables
        roster={roster}
        pointsPlayed={state.pointsPlayed}
        playerOutcomes={playerOutcomes}
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
    </div>
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

// ── Line history ─────────────────────────────────────────────────────────────

function LineHistory({
  points,
  byId,
}: {
  points: Point[];
  byId: Map<string, RosterSnapshotEntry>;
}) {
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
            </div>
            <p className="mt-1 text-faint">
              {p.lineup.map((id) => nameFor(id)).join(", ")}
            </p>
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
    </details>
  );
}

// ── Points-played tables ─────────────────────────────────────────────────────

type StatSortMode = "points" | "dPlusMinus" | "oPlusMinus";

function PointsPlayedTables({
  roster,
  pointsPlayed,
  playerOutcomes,
}: {
  roster: RosterSnapshotEntry[];
  pointsPlayed: Record<string, number>;
  playerOutcomes: Record<string, PlayerPointOutcomes>;
}) {
  const [sortMode, setSortMode] = useState<StatSortMode>("points");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-faint">Sort:</span>
        <StatSortButton
          label="Points"
          active={sortMode === "points"}
          onClick={() => setSortMode("points")}
        />
        <StatSortButton
          label="D +/-"
          active={sortMode === "dPlusMinus"}
          onClick={() => setSortMode("dPlusMinus")}
        />
        <StatSortButton
          label="O +/-"
          active={sortMode === "oPlusMinus"}
          onClick={() => setSortMode("oPlusMinus")}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <PointsPlayedTable
          gender="MMP"
          roster={roster}
          pointsPlayed={pointsPlayed}
          playerOutcomes={playerOutcomes}
          sortMode={sortMode}
        />
        <PointsPlayedTable
          gender="WMP"
          roster={roster}
          pointsPlayed={pointsPlayed}
          playerOutcomes={playerOutcomes}
          sortMode={sortMode}
        />
      </div>
    </div>
  );
}

function StatSortButton({
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

function PointsPlayedTable({
  gender,
  roster,
  pointsPlayed,
  playerOutcomes,
  sortMode,
}: {
  gender: GenderMatch;
  roster: RosterSnapshotEntry[];
  pointsPlayed: Record<string, number>;
  playerOutcomes: Record<string, PlayerPointOutcomes>;
  sortMode: StatSortMode;
}) {
  const rows = roster
    .filter((p) => p.genderMatch === gender)
    .map((p) => {
      const o = playerOutcomes[p.playerId];
      return {
        p,
        count: pointsPlayed[p.playerId] ?? 0,
        oPlusMinus: o?.oPlusMinus ?? 0,
        dPlusMinus: o?.dPlusMinus ?? 0,
      };
    })
    .sort((a, b) => {
      const diff =
        sortMode === "points"
          ? b.count - a.count
          : sortMode === "dPlusMinus"
            ? b.dPlusMinus - a.dPlusMinus
            : b.oPlusMinus - a.oPlusMinus;
      return diff || displayName(a.p).localeCompare(displayName(b.p));
    });

  const headerTone =
    gender === "MMP"
      ? "text-sky-600 dark:text-sky-400"
      : "text-rose-600 dark:text-rose-400";

  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th
            className={`border-b border-line pb-1 text-left text-xs font-semibold uppercase tracking-wide ${headerTone}`}
          >
            {gender}
          </th>
          <th className="border-b border-line pb-1 text-right text-xs font-semibold uppercase tracking-wide text-faint">
            Pts
          </th>
          <th className="border-b border-line pb-1 text-right text-xs font-semibold uppercase tracking-wide text-faint">
            D +/-
          </th>
          <th className="border-b border-line pb-1 text-right text-xs font-semibold uppercase tracking-wide text-faint">
            O +/-
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ p, count, oPlusMinus, dPlusMinus }) => (
          <tr key={p.playerId}>
            <td className="border-b border-line py-1">{displayName(p)}</td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {count}
            </td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {formatPlusMinus(dPlusMinus)}
            </td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {formatPlusMinus(oPlusMinus)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
