"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Game, GenderMatch, Point } from "@shared/game-rules";
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
      {live.state.phase === "completed" ? (
        <Recap live={live} />
      ) : (
        // awaiting_line + point_in_progress are both handled inside the caller.
        <LiveCaller live={live} />
      )}
    </div>
  );
}

// Per-game sync indicator + manual resync (§ conflict handling). Automatic
// flushes happen on every commit; this surfaces the outcome and gives the coach
// a way to push through a conflict or an offline backlog on demand.
function SyncBar({ live }: { live: LiveGame }) {
  const { sync, actions } = live;

  const label = (() => {
    switch (sync.status) {
      case "syncing":
        return "Syncing…";
      case "conflict":
        return "Sync conflict — another device updated this game";
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
    sync.status === "conflict"
      ? "text-red-600 dark:text-red-400"
      : sync.status === "offline"
        ? "text-amber-600 dark:text-amber-400"
        : "text-faint";

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
  const { game, state, points, roster, actions, canUndo } = live;
  const byId = useMemo(
    () => new Map(roster.map((p) => [p.playerId, p])),
    [roster],
  );

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
        {game.gameCap}-cap
      </p>

      {canUndo && (
        <button
          onClick={actions.undo}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
        >
          Undo end
        </button>
      )}

      <LineHistory points={points} byId={byId} />

      <PointsPlayedTables roster={roster} pointsPlayed={state.pointsPlayed} />
    </section>
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

function PointsPlayedTables({
  roster,
  pointsPlayed,
}: {
  roster: RosterSnapshotEntry[];
  pointsPlayed: Record<string, number>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <PointsPlayedTable
        gender="MMP"
        roster={roster}
        pointsPlayed={pointsPlayed}
      />
      <PointsPlayedTable
        gender="WMP"
        roster={roster}
        pointsPlayed={pointsPlayed}
      />
    </div>
  );
}

function PointsPlayedTable({
  gender,
  roster,
  pointsPlayed,
}: {
  gender: GenderMatch;
  roster: RosterSnapshotEntry[];
  pointsPlayed: Record<string, number>;
}) {
  const rows = roster
    .filter((p) => p.genderMatch === gender)
    .map((p) => ({ p, count: pointsPlayed[p.playerId] ?? 0 }))
    .sort((a, b) => b.count - a.count || displayName(a.p).localeCompare(displayName(b.p)));

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
        </tr>
      </thead>
      <tbody>
        {rows.map(({ p, count }) => (
          <tr key={p.playerId}>
            <td className="border-b border-line py-1">{displayName(p)}</td>
            <td className="border-b border-line py-1 text-right tabular-nums text-muted">
              {count}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
