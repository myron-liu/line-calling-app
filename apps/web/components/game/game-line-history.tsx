"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deriveLiveGameState,
  ratioCounts,
  ratioForPoint,
  type Game,
  type GameMeta,
  type GenderRatio,
  type Point,
} from "@shared/game-rules";
import {
  isRosterActive,
  readGameConfig,
  readLog,
  readMeta,
  readRosterSnapshot,
  writePendingReplay,
  type RosterSnapshotEntry,
} from "@/lib/storage/gameLog";
import { keys } from "@/lib/storage/keys";
import { displayName, sortRoster } from "@/lib/player-display";

const defaultMeta = (g: Game): GameMeta => ({
  halftimeReached: false,
  ourTimeoutsRemaining: g.timeoutsPerHalf,
  theirTimeoutsRemaining: g.timeoutsPerHalf,
  endedManually: false,
});

/** Read-only viewer for a live game's completed lines, opened in its own tab
 *  from the live caller so both stay visible at once. It reads the same
 *  localStorage the live tab writes (no server round-trip), and sends a
 *  chosen lineup back to that tab via a `storage`-event signal. */
export function GameLineHistory({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<Game | null | undefined>(undefined);
  const [points, setPoints] = useState<Point[]>([]);
  const [meta, setMeta] = useState<GameMeta | null>(null);
  const [roster, setRoster] = useState<RosterSnapshotEntry[]>([]);
  const [queuedPointId, setQueuedPointId] = useState<string | null>(null);

  const load = useCallback(() => {
    const g = readGameConfig(gameId);
    setGame(g);
    if (!g) return;
    setPoints(readLog(gameId));
    setMeta(readMeta(gameId) ?? defaultMeta(g));
    setRoster(readRosterSnapshot(gameId));
  }, [gameId]);

  useEffect(load, [load]);

  // The live tab keeps writing to these keys as the game goes on; re-read so
  // this view doesn't silently go stale next to it.
  useEffect(() => {
    const watched = new Set([
      keys.gameLog(gameId),
      keys.gameMeta(gameId),
      keys.gameRoster(gameId),
      keys.gameConfig(gameId),
    ]);
    const handler = (e: StorageEvent) => {
      if (e.key && watched.has(e.key)) load();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [gameId, load]);

  const byId = useMemo(
    () => new Map(roster.map((p) => [p.playerId, p])),
    [roster],
  );
  const eligibleIds = useMemo(
    () =>
      new Set(
        roster.filter((p) => !p.injured && isRosterActive(p)).map((p) => p.playerId),
      ),
    [roster],
  );

  if (game === undefined) return <p className="text-muted">Loading…</p>;
  if (game === null) {
    return (
      <p className="py-8 text-center text-muted">
        No local data for this game — open it in the live caller first.
      </p>
    );
  }

  const state = deriveLiveGameState(game, points, meta ?? defaultMeta(game));

  // Which point a replayed line would actually be used for: the one being
  // built right now, or — while a point is still playing out — the next one,
  // since that's the LineBuilder the live tab has open (its "prepare next
  // line" panel). The gender ratio to filter against follows from that.
  const targetPointNumber =
    state.phase === "point_in_progress"
      ? state.currentPointNumber + 1
      : state.currentPointNumber;
  const targetRatio: GenderRatio | undefined = game.startingGenderRatio
    ? ratioForPoint(targetPointNumber, game.startingGenderRatio)
    : undefined;
  const need = targetRatio ? ratioCounts(targetRatio) : null;

  const completed = points.filter((p) => p.result !== undefined);

  const replay = (point: Point) => {
    writePendingReplay(gameId, point.lineup);
    setQueuedPointId(point.id);
  };

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Line history</h1>
        <p className="text-sm text-muted">
          {state.ourScore}–{state.theirScore} · picking for point{" "}
          {targetPointNumber}
          {need ? ` · ${need.mmp} MMP / ${need.wmp} WMP` : ""}
        </p>
        <p className="text-xs text-faint">
          Choosing a line loads it into this game&apos;s line builder in the
          tab you came from. Keep that tab open.
        </p>
      </div>

      {completed.length === 0 ? (
        <p className="text-sm text-muted">No completed points yet.</p>
      ) : (
        <ul className="space-y-2">
          {completed
            .slice()
            .reverse()
            .map((point) => (
              <HistoryRow
                key={point.id}
                point={point}
                byId={byId}
                eligibleIds={eligibleIds}
                need={need}
                queued={queuedPointId === point.id}
                onReplay={() => replay(point)}
              />
            ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({
  point,
  byId,
  eligibleIds,
  need,
  queued,
  onReplay,
}: {
  point: Point;
  byId: Map<string, RosterSnapshotEntry>;
  eligibleIds: Set<string>;
  /** Null for a non-mixed game: any lineup is ratio-viable. */
  need: { mmp: number; wmp: number } | null;
  queued: boolean;
  onReplay: () => void;
}) {
  const players = sortRoster(
    point.lineup.map((id) => byId.get(id)).filter((p): p is RosterSnapshotEntry => !!p),
  );
  const mmp = players.filter((p) => p.genderMatch === "MMP").length;
  const wmp = players.filter((p) => p.genderMatch === "WMP").length;

  // A line is replayable only if everyone on it is still available AND — in
  // Mixed — its composition exactly matches the ratio the upcoming point
  // requires, since anything else couldn't be confirmed as-is anyway.
  const allAvailable = point.lineup.every((id) => eligibleIds.has(id));
  const ratioOk = !need || (mmp === need.mmp && wmp === need.wmp);
  const viable = allAvailable && ratioOk;

  const won = point.result === "us";
  return (
    <li className={`rounded-lg border border-line p-2.5 ${viable ? "" : "opacity-60"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Point {point.pointNumber}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
              won
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                : "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
            }`}
          >
            {won ? "Scored" : "Conceded"}
          </span>
          <span className="text-xs text-faint">
            {point.od} · {mmp}M/{wmp}W
          </span>
        </div>
        <button
          onClick={onReplay}
          disabled={!viable || queued}
          className="shrink-0 rounded-md border border-line-strong px-2.5 py-1 text-sm disabled:opacity-40"
        >
          {queued ? "Sent ✓" : "Use line"}
        </button>
      </div>
      <p className="mt-1 text-sm">
        {players.map((p) => displayName(p)).join(" · ")}
      </p>
      {!viable && (
        <p className="mt-1 text-xs text-faint">
          {!allAvailable
            ? "Someone on this line is injured or off the roster."
            : `Doesn't match this point's ${need!.mmp} MMP / ${need!.wmp} WMP ratio.`}
        </p>
      )}
    </li>
  );
}
