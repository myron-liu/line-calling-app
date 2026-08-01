"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

/** Read-only viewer for a game's lines, opened in its own tab from the live
 *  caller so both stay visible at once. It reads the same localStorage the
 *  live tab writes (no server round-trip); choosing a line queues it there
 *  and navigates this tab back to the game, so it works whether the coach
 *  returns to the original tab or just carries on in this one. */
export function GameLineHistory({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [game, setGame] = useState<Game | null | undefined>(undefined);
  const [points, setPoints] = useState<Point[]>([]);
  const [meta, setMeta] = useState<GameMeta | null>(null);
  const [roster, setRoster] = useState<RosterSnapshotEntry[]>([]);

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
      <div className="space-y-3 py-8 text-center">
        <p className="text-muted">
          No local data for this game — open it in the live caller first.
        </p>
        <Link
          href={`/games/${gameId}`}
          className="text-sm text-emerald-700 underline dark:text-emerald-400"
        >
          Back to the game
        </Link>
      </div>
    );
  }

  const state = deriveLiveGameState(game, points, meta ?? defaultMeta(game));

  // Which point a replayed line would actually be used for: the one being
  // built right now, or — while a point is still playing out — the next one,
  // since that's the LineBuilder the live caller has open (its "prepare next
  // line" panel). The gender ratio to filter against follows from that.
  const targetPointNumber =
    state.phase === "point_in_progress"
      ? state.currentPointNumber + 1
      : state.currentPointNumber;
  const targetRatio: GenderRatio | undefined = game.startingGenderRatio
    ? ratioForPoint(targetPointNumber, game.startingGenderRatio)
    : undefined;
  const need = targetRatio ? ratioCounts(targetRatio) : null;

  const use = (point: Point) => {
    writePendingReplay(gameId, point.lineup);
    router.push(`/games/${gameId}`);
  };

  return (
    <section className="space-y-4">
      <Link
        href={`/games/${gameId}`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
      >
        <span aria-hidden>←</span> Back to the game
      </Link>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Line history</h1>
        <p className="text-sm text-muted">
          {state.ourScore}–{state.theirScore} · picking for point{" "}
          {targetPointNumber}
          {need ? ` · ${need.mmp} MMP / ${need.wmp} WMP` : ""}
        </p>
        <p className="text-xs text-faint">
          Choosing a line loads it into the line builder and takes you back to
          the game.
        </p>
      </div>

      {points.length === 0 ? (
        <p className="text-sm text-muted">No lines yet.</p>
      ) : (
        <ul className="space-y-2">
          {points
            .slice()
            .reverse()
            .map((point) => (
              <HistoryRow
                key={point.id}
                point={point}
                byId={byId}
                eligibleIds={eligibleIds}
                need={need}
                onUse={() => use(point)}
              />
            ))}
        </ul>
      )}
    </section>
  );
}

/** What the point's starting side plus its result add up to, in the terms a
 *  coach actually thinks in: starting on D and scoring is a break, starting
 *  on O and conceding is getting broken, and the other two are holds. */
function outcome(point: Point): {
  label: string;
  tone: string;
} | null {
  if (point.result === undefined) return null;
  const weScored = point.result === "us";
  if (point.od === "D") {
    return weScored
      ? {
          label: "Break",
          tone: "bg-emerald-600 text-white",
        }
      : {
          label: "They held",
          tone: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
        };
  }
  return weScored
    ? {
        label: "Hold",
        tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
      }
    : {
        label: "Broken",
        tone: "bg-red-600 text-white",
      };
}

function HistoryRow({
  point,
  byId,
  eligibleIds,
  need,
  onUse,
}: {
  point: Point;
  byId: Map<string, RosterSnapshotEntry>;
  eligibleIds: Set<string>;
  /** Null for a non-mixed game: any lineup is ratio-viable. */
  need: { mmp: number; wmp: number } | null;
  onUse: () => void;
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

  const inProgress = point.result === undefined;
  const result = outcome(point);
  return (
    <li
      className={`rounded-lg border p-2.5 ${
        inProgress ? "border-emerald-400 dark:border-emerald-500/50" : "border-line"
      } ${viable ? "" : "opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Point {point.pointNumber}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-semibold text-white ${
              point.od === "O" ? "bg-red-600" : "bg-blue-600"
            }`}
          >
            Started {point.od}
          </span>
          {result && (
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${result.tone}`}>
              {result.label}
            </span>
          )}
          {inProgress && (
            <span className="rounded px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              On the field now
            </span>
          )}
          <span className="text-xs text-faint">
            {mmp}M/{wmp}W
          </span>
        </div>
        <button
          onClick={onUse}
          disabled={!viable}
          className="shrink-0 rounded-md border border-line-strong px-2.5 py-1 text-sm disabled:opacity-40"
        >
          Use line
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
