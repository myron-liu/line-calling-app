"use client";

import { useMemo, useState } from "react";
import { ratioCounts, ratioForPoint, type Point } from "@shared/game-rules";
import type { LiveGame } from "@/lib/game/useLiveGame";
import { isRosterActive, type RosterSnapshotEntry } from "@/lib/storage/gameLog";
import { displayName, sortRoster } from "@/lib/player-display";
import { PointEditModal } from "./point-edit-modal";
import { StrategySummary } from "./live-caller";

/** The "Line history" tab of the live caller: every line this game has put on
 *  the field, newest first, with the one still out there at the top. Picking
 *  one hands it back to the caller's line builder (see onUseLine). */
export function LineHistory({
  live,
  onUseLine,
}: {
  live: LiveGame;
  onUseLine: (lineup: string[]) => void;
}) {
  const { game, roster, points, state, actions } = live;
  const [editing, setEditing] = useState<Point | null>(null);

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

  // Which point a reused line would actually be for: the one being built right
  // now, or — while a point is still playing out — the next one, since that's
  // the line builder the caller has open (its "prepare next line" panel). The
  // gender ratio to filter against follows from that.
  const targetPointNumber =
    state.phase === "point_in_progress"
      ? state.currentPointNumber + 1
      : state.currentPointNumber;
  const need = game.startingGenderRatio
    ? ratioCounts(ratioForPoint(targetPointNumber, game.startingGenderRatio))
    : null;

  // Running score before/after each point, so every row shows the transition
  // it produced (e.g. 3-2 → 4-2) rather than just who won it.
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
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Picking for point {targetPointNumber}
        {need ? ` · ${need.mmp} MMP / ${need.wmp} WMP` : ""}
      </p>

      <StrategySummary points={points} />

      {points.length === 0 ? (
        <p className="text-sm text-muted">No lines yet.</p>
      ) : (
        <ul className="space-y-2">
          {points
            .map((point, i) => ({ point, transition: transitions[i]! }))
            .reverse()
            .map(({ point, transition }) => (
              <HistoryRow
                key={point.id}
                point={point}
                transition={transition}
                byId={byId}
                eligibleIds={eligibleIds}
                need={need}
                onUse={() => onUseLine(point.lineup)}
                onEdit={point.result !== undefined ? () => setEditing(point) : undefined}
              />
            ))}
        </ul>
      )}

      {editing && (
        <PointEditModal
          point={editing}
          roster={roster}
          strategyVocabulary={live.strategyVocabulary}
          onClose={() => setEditing(null)}
          onSave={(edit) => {
            actions.editPoint(editing.id, edit);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** Everything recorded by hand for one point (§ stats): who scored it, plus
 *  each D and turnover. Renders nothing when the coach recorded nothing. */
function PointStatLine({
  point,
  byId,
}: {
  point: Point;
  byId: Map<string, RosterSnapshotEntry>;
}) {
  const name = (id: string) => {
    const p = byId.get(id);
    return p ? displayName(p) : "Unknown";
  };
  const events = point.statEvents ?? [];
  const strategies = point.strategyTags ?? [];
  const s = point.scoring;
  if (!s && events.length === 0 && strategies.length === 0) return null;

  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      {strategies.map((tag) => (
        <span
          key={tag}
          className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-800 dark:bg-violet-500/20 dark:text-violet-300"
        >
          {tag}
        </span>
      ))}
      {s?.kind === "goal" && (
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
          {s.assistPlayerId ? `${name(s.assistPlayerId)} → ` : ""}
          {name(s.goalPlayerId)}
        </span>
      )}
      {s?.kind === "callahan" && (
        <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-800 dark:bg-violet-500/20 dark:text-violet-300">
          Callahan · {name(s.playerId)}
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
          {ev.type === "block" ? "D" : "T"} · {name(ev.playerId)}
        </span>
      ))}
    </p>
  );
}

/** What the point's starting side plus its result add up to, in the terms a
 *  coach actually thinks in: starting on D and scoring is a break, starting
 *  on O and conceding is getting broken, and the other two are holds. */
function outcome(point: Point): { label: string; tone: string } | null {
  if (point.result === undefined) return null;
  const weScored = point.result === "us";
  if (point.od === "D") {
    return weScored
      ? { label: "Break", tone: "bg-emerald-600 text-white" }
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
    : { label: "Broken", tone: "bg-red-600 text-white" };
}

interface Score {
  our: number;
  their: number;
}

function HistoryRow({
  point,
  transition,
  byId,
  eligibleIds,
  need,
  onUse,
  onEdit,
}: {
  point: Point;
  /** Running score either side of this point. */
  transition: { before: Score; after: Score };
  byId: Map<string, RosterSnapshotEntry>;
  eligibleIds: Set<string>;
  /** Null for a non-mixed game: any lineup is ratio-viable. */
  need: { mmp: number; wmp: number } | null;
  onUse: () => void;
  /** Omitted for the point still being played — correct that one live. */
  onEdit?: () => void;
}) {
  const players = sortRoster(
    point.lineup.map((id) => byId.get(id)).filter((p): p is RosterSnapshotEntry => !!p),
  );
  const mmp = players.filter((p) => p.genderMatch === "MMP").length;
  const wmp = players.filter((p) => p.genderMatch === "WMP").length;

  // Reusable only if everyone on it is still available AND — in Mixed — its
  // composition exactly matches the ratio the upcoming point requires, since
  // anything else couldn't be confirmed as-is anyway.
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
          {inProgress ? (
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              On the field now · {transition.before.our}-{transition.before.their}
            </span>
          ) : (
            <span className="text-xs tabular-nums text-faint">
              {transition.before.our}-{transition.before.their} →{" "}
              <span className="font-medium text-fg">
                {transition.after.our}-{transition.after.their}
              </span>
            </span>
          )}
          <span className="text-xs text-faint">
            {mmp}M/{wmp}W
          </span>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {onEdit && (
            <button
              onClick={onEdit}
              className="rounded-md border border-line-strong px-2.5 py-1 text-sm"
            >
              Edit
            </button>
          )}
          <button
            onClick={onUse}
            disabled={!viable}
            className="rounded-md border border-line-strong px-2.5 py-1 text-sm disabled:opacity-40"
          >
            Use line
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm">{players.map((p) => displayName(p)).join(" · ")}</p>
      <PointStatLine point={point} byId={byId} />
      {point.notes && (
        <p className="mt-1 text-xs italic text-muted">{point.notes}</p>
      )}
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
