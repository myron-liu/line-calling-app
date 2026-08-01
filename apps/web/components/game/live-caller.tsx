"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SITUATION_TAGS,
  genderStateLabel,
  playerSecondsPlayed,
  ratioCounts,
  ratioForPoint,
  suggestedSituationTag,
  totalPlayedSeconds,
  validateLine,
  type GenderRatio,
  type OD,
  type PointResult,
  type SavedLine,
  type Scoring,
  type SituationTag,
  type StatEvent,
  type StatEventType,
} from "@shared/game-rules";
import type { LiveGame } from "@/lib/game/useLiveGame";
import { isRosterActive, type RosterSnapshotEntry } from "@/lib/storage/gameLog";
import {
  LINE_COLOR_CHIP,
  ROLE_BADGE_COLOR,
  SITUATION_TAG_COLOR,
  displayName,
  roleTag,
  sortRoster,
} from "@/lib/player-display";
import { Modal } from "@/components/modal";
import { LineHistory } from "./game-line-history";

// ── Game clock (§8) ──────────────────────────────────────────────────────────

/** Re-renders every second while `active`, so a component reading Date.now()
 *  ticks live; otherwise renders once and never re-fires the interval — no
 *  point re-rendering a clock that isn't running (e.g. between points). */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// The live line caller (§8). Drives the engine hook; only reads/writes localStorage.
export function LiveCaller({ live }: { live: LiveGame }) {
  const { state, carryOver, points, error } = live;
  // The next line prepared during the current point_in_progress phase (see
  // InProgressControls) — seeds the following point's LineBuilder the moment
  // it opens, so confirming it is a single tap instead of rebuilding from
  // scratch. A fresh point_in_progress phase always starts this empty (its
  // embedded prepare-mode LineBuilder reports its own initial empty selection
  // right on mount), so nothing stale can leak into a later point.
  const [nextLineDraft, setNextLineDraft] = useState<string[]>([]);
  const [tab, setTab] = useState<"live" | "history">("live");
  // A lineup picked from the Line history tab. `nonce` changes on every pick —
  // even a repeated identical lineup — so the line builder's effect reliably
  // re-fires and applies it.
  const [replaySeed, setReplaySeed] = useState<{ nonce: number; lineup: string[] } | null>(
    null,
  );

  const useHistoricalLine = (lineup: string[]) => {
    setReplaySeed({ nonce: Date.now(), lineup });
    setTab("live");
  };

  return (
    <div className="space-y-4">
      <Header live={live} />
      {error && (
        <p className="rounded-md bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Line history is only worth a tab once there's a line to look back at
          — any point with a lineup counts, including one still being played. */}
      {points.length > 0 && (
        <div className="flex gap-1 border-b border-line text-sm">
          <Tab label="Live game" active={tab === "live"} onClick={() => setTab("live")} />
          <Tab
            label="Line history"
            active={tab === "history"}
            onClick={() => setTab("history")}
          />
        </div>
      )}

      {/* Both tabs stay mounted and are shown/hidden rather than swapped, so
          glancing at the history mid-build doesn't throw away a half-picked
          line (the builder's selection lives in its own state). */}
      <div className={tab === "live" ? "space-y-4" : "hidden"}>
        {state.phase === "awaiting_line" && (
          <LineBuilder
            live={live}
            key={`p${state.currentPointNumber}`}
            seed={nextLineDraft.length > 0 ? nextLineDraft : carryOver}
            mode="confirm"
            pointNumber={state.currentPointNumber}
            genderRatio={state.genderRatio}
            od={state.od}
            replaySeed={replaySeed}
          />
        )}
        {state.phase === "point_in_progress" && (
          <InProgressControls
            live={live}
            onNextLineDraftChange={setNextLineDraft}
            replaySeed={replaySeed}
          />
        )}

        <SecondaryControls live={live} />
      </div>

      <div className={tab === "history" ? "" : "hidden"}>
        <LineHistory live={live} onUseLine={useHistoricalLine} />
      </div>
    </div>
  );
}

function Tab({
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
      aria-current={active ? "page" : undefined}
      className={`-mb-px border-b-2 px-3 py-1.5 ${
        active
          ? "border-emerald-600 font-medium text-emerald-700 dark:text-emerald-400"
          : "border-transparent text-muted"
      }`}
    >
      {label}
    </button>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────────

function Header({ live }: { live: LiveGame }) {
  const { state, game, points } = live;
  const odColor = state.od === "O" ? "bg-red-600" : "bg-blue-600";
  const fieldSide = fieldSideLabel(live);
  // Cumulative game clock: completed points' recorded durations, plus the
  // current point's still-ticking elapsed time if one's in progress (see
  // PointClock in InProgressControls for the same point's own stopwatch).
  const now = useTicker(state.phase === "point_in_progress");
  const inProgressStartedAt = points.find((p) => p.result === undefined)?.startedAt;
  const liveElapsed = inProgressStartedAt
    ? (now - new Date(inProgressStartedAt).getTime()) / 1000
    : 0;
  const totalPlayed = totalPlayedSeconds(points) + liveElapsed;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          Point {state.currentPointNumber} · vs {game.opponentName}
        </h1>
        <span className="text-2xl font-bold tabular-nums">
          {state.ourScore}–{state.theirScore}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded px-2 py-0.5 font-semibold text-white ${odColor}`}>
          {state.od === "O" ? "OFFENSE" : "DEFENSE"}
        </span>
        {state.genderRatio && <RatioBadge live={live} />}
        {state.halftimeReached && (
          <span className="rounded bg-surface-2 px-2 py-0.5 text-muted">
            2nd half
          </span>
        )}
        <span className="text-muted">
          TO {state.ourTimeoutsRemaining}·{state.theirTimeoutsRemaining}
        </span>
        <span className="text-muted">Time played {formatClock(totalPlayed)}</span>
      </div>
      {fieldSide && <p className="text-xs text-muted">{fieldSide}</p>}
      {game.startingGenderRatio && (
        <GenderCycle
          startA={game.startingGenderRatio}
          currentPoint={state.currentPointNumber}
        />
      )}
    </div>
  );
}

// Which side of the field the team is on, relative to home, only worth
// calling out right when it's newly true: point 1 (as resolved at the flip)
// and the first point after halftime, when teams swap ends and the side
// that was true all first half flips to its opposite. Every other point it's
// unchanged from the point before, so saying nothing is the right default.
function fieldSideLabel(live: LiveGame): string | null {
  const { game, state, points } = live;
  if (!game.fieldSide) return null;

  const isFirstPoint = state.currentPointNumber === 1;
  const existing = points[state.currentPointNumber - 1];
  const isFirstAfterHalf = existing
    ? existing.isFirstAfterHalftime
    : state.halftimeReached && !points.some((p) => p.isFirstAfterHalftime);
  if (!isFirstPoint && !isFirstAfterHalf) return null;

  // The stored fieldSide is fixed at the flip (first-half assignment) — after
  // halftime, teams have swapped ends, so the *current* side is the opposite.
  const side = isFirstAfterHalf
    ? game.fieldSide === "left"
      ? "right"
      : "left"
    : game.fieldSide;
  return `${side === "left" ? "Left" : "Right"} side facing the field standing from home`;
}

// ABBA gender-match state indicator: the current point's slot plus the upcoming
// cycle, so the coach can see what's coming (§5). M-labels are MMP-majority points
// (blue), W-labels WMP-majority (rose); the current point is filled.
function GenderCycle({
  startA,
  currentPoint,
}: {
  startA: GenderRatio;
  currentPoint: number;
}) {
  const labels = Array.from({ length: 8 }, (_, k) =>
    genderStateLabel(currentPoint + k, startA),
  );
  return (
    <div className="flex items-center gap-1 overflow-x-auto text-xs">
      <span className="mr-0.5 text-faint">Cycle</span>
      {labels.map((label, i) => {
        const isMan = label.startsWith("M");
        if (i === 0) {
          return (
            <span
              key={i}
              className={`rounded px-1.5 py-0.5 font-bold text-white ${
                isMan ? "bg-sky-600" : "bg-rose-600"
              }`}
            >
              {label}
            </span>
          );
        }
        return (
          <span
            key={i}
            className={`px-0.5 ${isMan ? "text-sky-500" : "text-rose-500"}`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

function RatioBadge({ live }: { live: LiveGame }) {
  const { state } = live;
  if (!state.genderRatio) return null;
  const need = ratioCounts(state.genderRatio);
  const isMmpMajority = state.genderRatio === "4MMP_3WMP";
  const tone = isMmpMajority
    ? "bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-300"
    : "bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300";
  return (
    <span className={`rounded px-2 py-0.5 font-medium ${tone}`}>
      {need.mmp} MMP / {need.wmp} WMP
    </span>
  );
}

// ── Line builder (awaiting_line) ────────────────────────────────────────────────

// Per-gender visual tone: MMP = blue, WMP = rose.
const GENDER = {
  MMP: {
    label: "MMP",
    headerText: "text-sky-600 dark:text-sky-400",
    idle: "border-sky-200 dark:border-sky-500/30",
    selected: "border-sky-500 bg-sky-50 dark:bg-sky-500/10 font-medium",
    badge: "bg-sky-600",
  },
  WMP: {
    label: "WMP",
    headerText: "text-rose-600 dark:text-rose-400",
    idle: "border-rose-200 dark:border-rose-500/30",
    selected: "border-rose-500 bg-rose-50 dark:bg-rose-500/10 font-medium",
    badge: "bg-rose-600",
  },
} as const;

type SortMode = "roster" | "recency" | "playtime" | "minutes";

function LineBuilder({
  live,
  seed,
  mode,
  pointNumber,
  genderRatio,
  od,
  onSelectionChange,
  replaySeed,
}: {
  live: LiveGame;
  seed: string[] | null;
  /** "confirm" is the normal awaiting_line flow (targets the current point,
   *  ends in a Confirm-line button). "prepare" is a second, embedded instance
   *  rendered inside InProgressControls while the current point is still
   *  playing out — it targets the point AFTER that one, has no confirm
   *  action of its own, and just reports its selection upward via
   *  onSelectionChange so it can seed the real LineBuilder the moment that
   *  next point actually opens. */
  mode: "confirm" | "prepare";
  /** The point this instance is building for — state.currentPointNumber for
   *  "confirm", one more than that for "prepare". */
  pointNumber: number;
  /** Undefined for a non-mixed team either way. */
  genderRatio: GenderRatio | undefined;
  /** Undefined in "prepare" mode: which side you'll be on next depends on
   *  who wins the point still in progress, so it genuinely isn't known yet
   *  (see odForPoint in rules.ts) — only the gender ratio can be. */
  od: OD | undefined;
  onSelectionChange?: (ids: string[]) => void;
  /** A lineup queued from the line-history viewer's separate tab (see
   *  game-line-history.tsx) — applied to the current selection whenever its
   *  nonce changes, same as an initial seed but arriving mid-lifecycle. */
  replaySeed?: { nonce: number; lineup: string[] } | null;
}) {
  const { game, roster, state, savedLines, points, actions } = live;
  const isMixed = !!game.startingGenderRatio;
  const eligible = useMemo(
    () => roster.filter((p) => !p.injured && isRosterActive(p)),
    [roster],
  );
  const eligibleIds = useMemo(
    () => new Set(eligible.map((p) => p.playerId)),
    [eligible],
  );
  const byId = useMemo(
    () => new Map(eligible.map((p) => [p.playerId, p])),
    [eligible],
  );
  // All roster (incl. injured) for reading a saved line's gender composition.
  const allById = useMemo(
    () => new Map(roster.map((p) => [p.playerId, p])),
    [roster],
  );

  // Player tags (§ Player.tags) filter the roster list shown below — purely a
  // display filter, so it never touches eligibleIds/byId (selection,
  // validation, and quick-lines composition are unaffected either way; a
  // player picked via a saved line/pod just won't be visible to tap again
  // while the filter hides them). A plain useState resets to "all" every new
  // point for free, the same way tagFilter above does — both "confirm" and
  // "prepare" instances of this component remount fresh each point.
  const [playerTagFilter, setPlayerTagFilter] = useState<string | "all">("all");
  const availablePlayerTags = useMemo(
    () => Array.from(new Set(eligible.flatMap((p) => p.tags ?? []))).sort(),
    [eligible],
  );
  const visibleEligible =
    playerTagFilter === "all"
      ? eligible
      : eligible.filter((p) => p.tags?.includes(playerTagFilter));

  // Split eligible players by O/D preference for the two accordions below.
  // "both" and unset (no preference recorded) show up in both groups.
  const oGroup = useMemo(
    () => visibleEligible.filter((p) => p.odPreference !== "D"),
    [visibleEligible],
  );
  const dGroup = useMemo(
    () => visibleEligible.filter((p) => p.odPreference !== "O"),
    [visibleEligible],
  );
  const oIds = useMemo(() => new Set(oGroup.map((p) => p.playerId)), [oGroup]);
  const dIds = useMemo(() => new Set(dGroup.map((p) => p.playerId)), [dGroup]);

  // Points sat out since each player's last start (never-played = all completed
  // points so far). Flags long benches in the roster columns below. In
  // "prepare" mode, state.lastPlayedPoint/pointsPlayed don't reflect the
  // still-in-progress point yet (only completed points count there — see
  // rules.ts), even though everyone on state.currentLineup is unambiguously
  // about to have played it — so they're treated as having just played it.
  const completedThrough = pointNumber - 1;
  const benchGap = useMemo(() => {
    const gaps: Record<string, number> = {};
    for (const p of roster) {
      const last =
        mode === "prepare" && state.currentLineup.includes(p.playerId)
          ? completedThrough
          : (state.lastPlayedPoint[p.playerId] ?? 0);
      gaps[p.playerId] = completedThrough - last;
    }
    return gaps;
  }, [mode, roster, state.lastPlayedPoint, state.currentLineup, completedThrough]);

  // Who started the immediately preceding point — shown as "Just played"
  // instead of a numeric gap. Checked against lastPlayedPoint directly
  // (rather than benchGap === 0) so a player who's never started a point
  // doesn't false-positive at point 1, where everyone's gap defaults to 0.
  const justPlayedIds = useMemo(() => {
    if (mode === "prepare") return new Set(state.currentLineup);
    if (completedThrough <= 0) return new Set<string>();
    return new Set(
      roster
        .filter((p) => state.lastPlayedPoint[p.playerId] === completedThrough)
        .map((p) => p.playerId),
    );
  }, [mode, state.currentLineup, roster, state.lastPlayedPoint, completedThrough]);

  // Same "still in progress" adjustment as benchGap, for the "fewest points
  // played" sort.
  const effectivePointsPlayed = useMemo(() => {
    if (mode !== "prepare") return state.pointsPlayed;
    const merged = { ...state.pointsPlayed };
    for (const id of state.currentLineup) merged[id] = (merged[id] ?? 0) + 1;
    return merged;
  }, [mode, state.pointsPlayed, state.currentLineup]);

  // Each player's total time on the field so far (§4.4) — shown next to their
  // points-played count and used for the "Least minutes" sort. Only completed
  // points count (see playerSecondsPlayed), same convention as points played.
  const secondsPlayed = useMemo(() => playerSecondsPlayed(points), [points]);

  // Selectable slots per gender: the ratio in Mixed, otherwise up to a full line.
  const need = genderRatio ? ratioCounts(genderRatio) : null;
  const maxMMP = need ? need.mmp : 7;
  const maxWMP = need ? need.wmp : 7;

  const [selected, setSelected] = useState<string[]>(() =>
    (seed ?? []).filter((id) => eligibleIds.has(id)),
  );
  const [applyNote, setApplyNote] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("roster");
  // Which O/D accordion(s) are open — starts on whichever matches this point's
  // side, but applying a saved line/pod can force one or both open too (see
  // applyLine below). Genuinely controlled (not just an initial value) so we
  // can open it programmatically after the initial render. In "prepare" mode
  // od is undefined (not known yet), so both start open — there's no "wrong"
  // side to default-collapse when either is still possible.
  const [openSections, setOpenSections] = useState({
    O: od !== "D",
    D: od !== "O",
  });

  // "prepare" mode has no confirm step of its own — report the selection
  // upward so it can seed the real LineBuilder once this point actually opens.
  useEffect(() => {
    onSelectionChange?.(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  // Quick-lines tag filter. Any tag a line/pod carries can be filtered by —
  // the fixed situational vocabulary (SITUATION_TAGS) plus whatever custom
  // tags the team invented in the lines editor. It defaults to a suggestion
  // based on the game situation about to be played, but the coach can freely
  // override it for this point; a new point remounts LineBuilder via its
  // `key`, so the suggestion is recomputed fresh rather than fighting a
  // manual choice mid-point. Only applied if at least one saved line/pod
  // actually carries that tag — a team that hasn't adopted the situational
  // tags yet should never have its whole quick-lines bar silently emptied
  // out by a filter it never asked for.
  const [tagFilter, setTagFilter] = useState<string>(() => {
    const suggestion = suggestedSituationTag(
      game.gameCap,
      state.ourScore,
      state.theirScore,
      state.halftimeReached,
      points,
    );
    return savedLines.some((l) => l.tags?.includes(suggestion)) ? suggestion : "all";
  });
  // Prune anyone who becomes ineligible (e.g. marked injured mid-build) without
  // resetting the rest of the pick — this only fires within the same point, since
  // a new point remounts LineBuilder via its `key` and re-seeds from scratch.
  useEffect(() => {
    setSelected((cur) => cur.filter((id) => eligibleIds.has(id)));
  }, [eligibleIds]);

  useEffect(() => {
    if (!replaySeed) return;
    setSelected(replaySeed.lineup.filter((id) => eligibleIds.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaySeed?.nonce]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id); // deselect always ok
      if (cur.length >= 7) return cur; // never exceed a full line
      const p = byId.get(id);
      if (p) {
        const sameGender = cur.filter(
          (cid) => byId.get(cid)?.genderMatch === p.genderMatch,
        ).length;
        const cap = p.genderMatch === "MMP" ? maxMMP : maxWMP;
        if (sameGender >= cap) return cur; // that gender's slots are full
      }
      return [...cur, id];
    });

  // Ratio-slot labels in selection order: M1, M2 … / W1, W2 …
  const slotLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    let m = 0;
    let w = 0;
    for (const id of selected) {
      const p = byId.get(id);
      if (!p) continue;
      labels[id] = p.genderMatch === "MMP" ? `M${++m}` : `W${++w}`;
    }
    return labels;
  }, [selected, byId]);

  const selectedPlayers = eligible
    .filter((p) => selected.includes(p.playerId))
    .map((p) => ({ id: p.playerId, genderMatch: p.genderMatch, role: p.role }));

  // Handler/Cutter/Both counts among the current selection, so the coach can
  // see the line's shape at a glance alongside the gender-ratio counter.
  const roleCounts = selectedPlayers.reduce(
    (acc, p) => {
      if (p.role === "handler") acc.handler++;
      else if (p.role === "cutter") acc.cutter++;
      else acc.both++;
      return acc;
    },
    { handler: 0, cutter: 0, both: 0 },
  );

  const result = validateLine({
    division: isMixed ? "mixed" : "open",
    requiredRatio: genderRatio,
    players: selectedPlayers,
    eligiblePlayerIds: eligibleIds,
  });

  const totalReached = selected.length >= 7;
  const mmpFull = totalReached || result.mmp >= maxMMP;
  const wmpFull = totalReached || result.wmp >= maxWMP;

  // Quick lines that fit this point: full lines whose composition matches the ratio
  // exactly, plus partial pods whose composition fits under the point's gender caps.
  // Counts every saved player, including anyone currently injured — used for the
  // chip's displayed "4M/3W" composition, which describes the pod as saved.
  const composition = (playerIds: string[]) => {
    let mmp = 0;
    let wmp = 0;
    for (const id of playerIds) {
      const g = allById.get(id)?.genderMatch;
      if (g === "MMP") mmp++;
      else if (g === "WMP") wmp++;
    }
    return { mmp, wmp };
  };
  // Same tally, but skipping anyone currently injured/inactive — used to decide
  // whether a pod fits this point's caps (a roster-inactive player, e.g.
  // removed from check-in, is excluded the same way an injured one is here,
  // even though a *line/pod containing an injured player* is now hidden
  // outright below rather than judged by what's left of it).
  const eligibleComposition = (playerIds: string[]) => {
    let mmp = 0;
    let wmp = 0;
    for (const id of playerIds) {
      const g = byId.get(id)?.genderMatch;
      if (g === "MMP") mmp++;
      else if (g === "WMP") wmp++;
    }
    return { mmp, wmp };
  };
  // Lines/pods tagged for this point's side sort first (untagged/"both" in the
  // middle, the opposite side last), so the relevant quick-fills are right
  // there without scanning past ones for the other side. In "prepare" mode
  // there's no known side yet, so side-tagged pods rank equally — only
  // untagged/"both" ones (equally useful either way) get a boost.
  const sideMatchRank = (lineSide: SavedLine["side"]): number => {
    if (!od) return !lineSide || lineSide === "both" ? 0 : 1;
    if (lineSide === od) return 0;
    if (!lineSide || lineSide === "both") return 1;
    return 2;
  };

  // A line/pod fits if its MMP and WMP counts each stay within the point's caps.
  // For a full 7 this forces an exact ratio match; for a pod it just has to fit.
  // Any line/pod with a currently-injured player is hidden outright rather
  // than shown with that player silently dropped — the coach picks a
  // different quick-fill (or builds the line manually) instead of applying
  // one that's quietly missing someone.
  const quickLines = savedLines
    .filter((line) => !line.hidden)
    .filter((line) => !line.playerIds.some((id) => allById.get(id)?.injured))
    .map((line) => ({ line, ...composition(line.playerIds) }))
    .filter((x) => {
      if (x.line.playerIds.length < 1 || x.line.playerIds.length > 7) return false;
      const elig = eligibleComposition(x.line.playerIds);
      return elig.mmp <= maxMMP && elig.wmp <= maxWMP;
    })
    .sort((a, b) => {
      const side = sideMatchRank(a.line.side) - sideMatchRank(b.line.side);
      if (side !== 0) return side;
      return a.line.name.localeCompare(b.line.name);
    });

  const visibleQuickLines =
    tagFilter === "all" ? quickLines : quickLines.filter((x) => x.line.tags?.includes(tagFilter));

  // Filter chips: the fixed situational tags (always offered, in their canonical
  // order) followed by any custom tags this tournament's lines/pods actually
  // carry, so a team's own vocabulary is filterable too. Built off every saved
  // line rather than just the ones fitting this point, so the chip row doesn't
  // shuffle as the ratio changes point to point.
  const filterTags = useMemo(() => {
    const custom = new Set<string>();
    for (const l of savedLines) {
      for (const t of l.tags ?? []) {
        if (!SITUATION_TAGS.includes(t as SituationTag)) custom.add(t);
      }
    }
    return [...SITUATION_TAGS, ...[...custom].sort((a, b) => a.localeCompare(b))];
  }, [savedLines]);

  // The exact saved line/pod that was on the field for the immediately
  // preceding point (if any exactly matches it), labeled "Just played" in the
  // quick-lines bar below. That label tracks any surviving overlap with the
  // current selection rather than an exact-match snapshot, so it persists
  // through swapping a player or two while building the next line, but drops
  // once nothing from it remains selected — whether because the coach
  // individually swapped out the whole line or re-tapped the pod chip to
  // clear it outright (both just mean "selected" no longer overlaps it).
  const previousLineup = points.length > 0 ? points[points.length - 1]!.lineup : null;
  const justPlayedLineId = (() => {
    if (!previousLineup) return null;
    const prevSet = new Set(previousLineup);
    const match = savedLines.find(
      (l) => l.playerIds.length === prevSet.size && l.playerIds.every((id) => prevSet.has(id)),
    );
    return match?.id ?? null;
  })();
  const justPlayedId =
    justPlayedLineId !== null && previousLineup!.some((id) => selected.includes(id))
      ? justPlayedLineId
      : null;

  // Controlled (not just an initial value) so the coach can freely collapse it
  // for this point without it springing back open on the next re-render.
  const [quickLinesOpen, setQuickLinesOpen] = useState(true);

  // Add players up to the caps, deduping and skipping ineligible ones.
  const mergeWithCaps = (base: string[], incoming: string[]) => {
    const next = [...base];
    let skipped = 0;
    for (const id of incoming) {
      if (next.includes(id)) continue;
      if (!eligibleIds.has(id)) {
        skipped++;
        continue;
      }
      if (next.length >= 7) {
        skipped++;
        continue;
      }
      const p = byId.get(id);
      if (p && need) {
        const sameGender = next.filter(
          (cid) => byId.get(cid)?.genderMatch === p.genderMatch,
        ).length;
        const cap = p.genderMatch === "MMP" ? maxMMP : maxWMP;
        if (sameGender >= cap) {
          skipped++;
          continue;
        }
      }
      next.push(id);
    }
    return { next, skipped };
  };

  // A full line is "applied" iff the selection is exactly its player set; a pod is
  // "applied" iff every one of its players is currently selected. Either way,
  // pressing an applied line/pod again toggles it off.
  const isLineApplied = (line: SavedLine): boolean => {
    if (line.playerIds.length === 7) {
      return (
        selected.length === line.playerIds.length &&
        line.playerIds.every((id) => selected.includes(id))
      );
    }
    return line.playerIds.length > 0 && line.playerIds.every((id) => selected.includes(id));
  };
  const appliedLineIds = new Set(
    quickLines.map((x) => x.line).filter(isLineApplied).map((l) => l.id),
  );

  const applyLine = (line: SavedLine) => {
    if (isLineApplied(line)) {
      // Toggle off: drop just this line/pod's players from the selection.
      setSelected((cur) => cur.filter((id) => !line.playerIds.includes(id)));
      setApplyNote(null);
      return;
    }
    // Full line = drop-in (replace); pod = stack onto the current selection.
    const base = line.playerIds.length === 7 ? [] : selected;
    const { next, skipped } = mergeWithCaps(base, line.playerIds);
    setSelected(next);
    // Usage is recorded when the line is confirmed onto the field (see
    // confirmAndRecordUsage below), not here — the selection can still change
    // before the point is actually confirmed.
    setApplyNote(
      skipped > 0
        ? `${skipped} player${skipped > 1 ? "s" : ""} skipped (unavailable or over-ratio)`
        : null,
    );
    // Open whichever accordion(s) this pod's players actually live in, so the
    // coach can see them without having to hunt for the collapsed section —
    // never closes the other one, only opens what's relevant.
    const hasO = line.playerIds.some((id) => oIds.has(id));
    const hasD = line.playerIds.some((id) => dIds.has(id));
    if (hasO || hasD) {
      setOpenSections((s) => ({ O: s.O || hasO, D: s.D || hasD }));
    }
  };

  return (
    <div className="space-y-3">
      <SavedLinesBar
        lines={visibleQuickLines}
        appliedIds={appliedLineIds}
        justPlayedId={justPlayedId}
        ratioLabel={need ? `${maxMMP}M / ${maxWMP}W` : null}
        onApply={applyLine}
        note={applyNote}
        open={quickLinesOpen}
        onOpenChange={setQuickLinesOpen}
        tagFilter={tagFilter}
        onTagFilterChange={setTagFilter}
        filterTags={filterTags}
      />

      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {selected.length}/7 selected
          {isMixed && (
            <span className="ml-2">
              <span className={GENDER.MMP.headerText}>
                MMP {result.mmp}/{maxMMP}
              </span>
              <span className="text-faint"> · </span>
              <span className={GENDER.WMP.headerText}>
                WMP {result.wmp}/{maxWMP}
              </span>
            </span>
          )}
        </span>
        {selected.length > 0 && (
          <button
            onClick={() => setSelected([])}
            className="text-xs font-medium text-muted hover:text-fg"
          >
            Deselect all
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <span className={`rounded px-1 font-semibold ${ROLE_BADGE_COLOR.handler}`}>
          H {roleCounts.handler}
        </span>
        <span className={`rounded px-1 font-semibold ${ROLE_BADGE_COLOR.cutter}`}>
          C {roleCounts.cutter}
        </span>
        <span className={`rounded px-1 font-semibold ${ROLE_BADGE_COLOR.both}`}>
          H/C {roleCounts.both}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-faint">Sort:</span>
        <SortToggleButton
          label="Roster"
          active={sortMode === "roster"}
          onClick={() => setSortMode("roster")}
        />
        <SortToggleButton
          label="Least recent"
          active={sortMode === "recency"}
          onClick={() => setSortMode("recency")}
        />
        <SortToggleButton
          label="Least points"
          active={sortMode === "playtime"}
          onClick={() => setSortMode("playtime")}
        />
        <SortToggleButton
          label="Least minutes"
          active={sortMode === "minutes"}
          onClick={() => setSortMode("minutes")}
        />
      </div>

      {availablePlayerTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-faint">Tag:</span>
          <SortToggleButton
            label="All"
            active={playerTagFilter === "all"}
            onClick={() => setPlayerTagFilter("all")}
          />
          {availablePlayerTags.map((tag) => (
            <SortToggleButton
              key={tag}
              label={tag}
              active={playerTagFilter === tag}
              onClick={() => setPlayerTagFilter(tag)}
            />
          ))}
        </div>
      )}

      <ODAccordion
        label="Offense"
        tone="O"
        open={openSections.O}
        onOpenChange={(open) => setOpenSections((s) => ({ ...s, O: open }))}
        players={oGroup}
        selected={selected}
        slotLabels={slotLabels}
        pointsPlayed={effectivePointsPlayed}
        secondsPlayed={secondsPlayed}
        benchGap={benchGap}
        justPlayedIds={justPlayedIds}
        sortMode={sortMode}
        mmpFull={mmpFull}
        wmpFull={wmpFull}
        isMixed={isMixed}
        onToggle={toggle}
      />
      <ODAccordion
        label="Defense"
        tone="D"
        open={openSections.D}
        onOpenChange={(open) => setOpenSections((s) => ({ ...s, D: open }))}
        players={dGroup}
        selected={selected}
        slotLabels={slotLabels}
        pointsPlayed={effectivePointsPlayed}
        secondsPlayed={secondsPlayed}
        benchGap={benchGap}
        justPlayedIds={justPlayedIds}
        sortMode={sortMode}
        mmpFull={mmpFull}
        wmpFull={wmpFull}
        isMixed={isMixed}
        onToggle={toggle}
      />

      <InjuryManager
        roster={roster.filter(isRosterActive)}
        onToggle={(id, injured) => actions.setInjured(id, injured)}
      />

      <SaveLineButton
        selectedCount={selected.length}
        onSave={(name) => actions.saveLine(name, selected)}
      />

      {mode === "confirm" && (
        <>
          <button
            disabled={!result.valid}
            onClick={() => {
              // Only count a line/pod as "used" once it actually lands on the
              // field — checked against the final selection, not whatever was
              // true when it was tapped (the pick can still change afterward).
              for (const line of savedLines) {
                if (isLineApplied(line)) actions.recordLineUsage(line.id);
              }
              actions.confirmLine(selected);
            }}
            className="w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-disabled"
          >
            Confirm line ▸
          </button>
          {!result.valid && result.issues[0] && (
            <p className="text-center text-xs text-muted">
              {result.issues[0].message}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// Collapsible O/D grouping (§8): splits the eligible roster by preferred side so
// the coach can jump straight to the relevant half of the roster for this point.
// "both"/unset players show up in both accordions. Open state starts on
// whichever side matches the point's current O/D and is otherwise fully
// controlled by the parent (LineBuilder), which also force-opens a side when
// a saved line/pod with players on it is applied.
const OD_ACCORDION_TONE = {
  O: {
    border: "border-sky-300 dark:border-sky-500/40",
    text: "text-sky-700 dark:text-sky-400",
  },
  D: {
    border: "border-orange-300 dark:border-orange-500/40",
    text: "text-orange-700 dark:text-orange-400",
  },
} as const;

// The "last played N points ago" text reads neutral gray at 0 and ramps
// toward red as N grows, saturating fully by this many points.
const BENCH_GAP_SATURATION = 8;
const BENCH_GAP_FROM = [148, 163, 184] as const; // slate-400 — reads fine in both themes
const BENCH_GAP_TO = [239, 68, 68] as const; // red-500

function benchGapColor(gap: number): string {
  const t = Math.min(Math.max(gap, 0) / BENCH_GAP_SATURATION, 1);
  const [r, g, b] = BENCH_GAP_FROM.map((c, i) => Math.round(c + (BENCH_GAP_TO[i]! - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

function SortToggleButton({
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

function ODAccordion({
  label,
  tone,
  open,
  onOpenChange,
  players,
  selected,
  slotLabels,
  pointsPlayed,
  secondsPlayed,
  benchGap,
  justPlayedIds,
  sortMode,
  mmpFull,
  wmpFull,
  isMixed,
  onToggle,
}: {
  label: string;
  tone: "O" | "D";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: RosterSnapshotEntry[];
  selected: string[];
  slotLabels: Record<string, string>;
  pointsPlayed: Record<string, number>;
  secondsPlayed: Record<string, number>;
  benchGap: Record<string, number>;
  justPlayedIds: Set<string>;
  sortMode: SortMode;
  mmpFull: boolean;
  wmpFull: boolean;
  isMixed: boolean;
  onToggle: (id: string) => void;
}) {
  const t = OD_ACCORDION_TONE[tone];
  // How many of the current selection come from this O/D group, split by
  // gender — lets the coach see each side's contribution to the line at a
  // glance, without expanding the accordion.
  const selectedCount = players.reduce(
    (acc, p) => {
      if (!selected.includes(p.playerId)) return acc;
      if (p.genderMatch === "MMP") acc.mmp++;
      else acc.wmp++;
      return acc;
    },
    { mmp: 0, wmp: 0 },
  );
  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
      className={`rounded-lg border p-2 ${t.border}`}
    >
      <summary className={`cursor-pointer text-sm font-semibold ${t.text}`}>
        {label} <span className="font-normal text-faint">({players.length})</span>
        {isMixed && (
          <span className="ml-2 font-normal text-faint">
            {selectedCount.mmp}M/{selectedCount.wmp}W selected
          </span>
        )}
      </summary>
      <div className="mt-2">
        <GenderColumns
          players={players}
          selected={selected}
          slotLabels={slotLabels}
          pointsPlayed={pointsPlayed}
          secondsPlayed={secondsPlayed}
          benchGap={benchGap}
          justPlayedIds={justPlayedIds}
          sortMode={sortMode}
          mmpFull={mmpFull}
          wmpFull={wmpFull}
          isMixed={isMixed}
          onToggle={onToggle}
        />
      </div>
    </details>
  );
}

/** Highest bench gap (longest since last started) first; ties broken by name. */
function sortByRecency<T extends RosterSnapshotEntry>(
  players: T[],
  benchGap: Record<string, number>,
): T[] {
  return [...players].sort((a, b) => {
    const gap = (benchGap[b.playerId] ?? 0) - (benchGap[a.playerId] ?? 0);
    if (gap !== 0) return gap;
    return displayName(a).localeCompare(displayName(b));
  });
}

/** Fewest of some count/duration first (points played, seconds played, …);
 *  ties broken by name. */
function sortByFewest<T extends RosterSnapshotEntry>(
  players: T[],
  counts: Record<string, number>,
): T[] {
  return [...players].sort((a, b) => {
    const diff = (counts[a.playerId] ?? 0) - (counts[b.playerId] ?? 0);
    if (diff !== 0) return diff;
    return displayName(a).localeCompare(displayName(b));
  });
}

function GenderColumns({
  players,
  selected,
  slotLabels,
  pointsPlayed,
  secondsPlayed,
  benchGap,
  justPlayedIds,
  sortMode,
  mmpFull,
  wmpFull,
  isMixed,
  onToggle,
}: {
  players: RosterSnapshotEntry[];
  selected: string[];
  slotLabels: Record<string, string>;
  pointsPlayed: Record<string, number>;
  secondsPlayed: Record<string, number>;
  benchGap: Record<string, number>;
  justPlayedIds: Set<string>;
  sortMode: SortMode;
  mmpFull: boolean;
  wmpFull: boolean;
  isMixed: boolean;
  onToggle: (id: string) => void;
}) {
  const sort =
    sortMode === "recency"
      ? (list: RosterSnapshotEntry[]) => sortByRecency(list, benchGap)
      : sortMode === "playtime"
        ? (list: RosterSnapshotEntry[]) => sortByFewest(list, pointsPlayed)
        : sortMode === "minutes"
          ? (list: RosterSnapshotEntry[]) => sortByFewest(list, secondsPlayed)
          : sortRoster;

  // Single-division team (Open/Women): every player shares the same
  // genderMatch, so an MMP/WMP split is redundant — just two plain columns.
  if (!isMixed) {
    const sorted = sort(players);
    const mid = Math.ceil(sorted.length / 2);
    const tone: "MMP" | "WMP" = players.some((p) => p.genderMatch === "WMP")
      ? "WMP"
      : "MMP";
    const columnFull = mmpFull || wmpFull;
    return (
      <div className="grid grid-cols-2 gap-3">
        <RosterColumn
          tone={tone}
          players={sorted.slice(0, mid)}
          selected={selected}
          slotLabels={slotLabels}
          pointsPlayed={pointsPlayed}
          secondsPlayed={secondsPlayed}
          benchGap={benchGap}
          justPlayedIds={justPlayedIds}
          columnFull={columnFull}
          onToggle={onToggle}
        />
        <RosterColumn
          tone={tone}
          players={sorted.slice(mid)}
          selected={selected}
          slotLabels={slotLabels}
          pointsPlayed={pointsPlayed}
          secondsPlayed={secondsPlayed}
          benchGap={benchGap}
          justPlayedIds={justPlayedIds}
          columnFull={columnFull}
          onToggle={onToggle}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <RosterColumn
        tone="MMP"
        label="MMP"
        players={sort(players.filter((p) => p.genderMatch === "MMP"))}
        selected={selected}
        slotLabels={slotLabels}
        pointsPlayed={pointsPlayed}
        secondsPlayed={secondsPlayed}
        benchGap={benchGap}
        justPlayedIds={justPlayedIds}
        columnFull={mmpFull}
        onToggle={onToggle}
      />
      <RosterColumn
        tone="WMP"
        label="WMP"
        players={sort(players.filter((p) => p.genderMatch === "WMP"))}
        selected={selected}
        slotLabels={slotLabels}
        pointsPlayed={pointsPlayed}
        secondsPlayed={secondsPlayed}
        benchGap={benchGap}
        justPlayedIds={justPlayedIds}
        columnFull={wmpFull}
        onToggle={onToggle}
      />
    </div>
  );
}

function RosterColumn({
  tone,
  label,
  players,
  selected,
  slotLabels,
  pointsPlayed,
  secondsPlayed,
  benchGap,
  justPlayedIds,
  columnFull,
  onToggle,
}: {
  tone: "MMP" | "WMP";
  /** Omitted for a single-division team, where MMP/WMP is redundant. */
  label?: string;
  players: RosterSnapshotEntry[];
  selected: string[];
  slotLabels: Record<string, string>;
  pointsPlayed: Record<string, number>;
  secondsPlayed: Record<string, number>;
  benchGap: Record<string, number>;
  justPlayedIds: Set<string>;
  columnFull: boolean;
  onToggle: (id: string) => void;
}) {
  const t = GENDER[tone];
  return (
    <div>
      {label && (
        <p
          className={`mb-1 text-xs font-semibold uppercase tracking-wide ${t.headerText}`}
        >
          {label}
        </p>
      )}
      <ul className="space-y-1">
        {players.map((p) => {
          const isSel = selected.includes(p.playerId);
          const disabled = !isSel && columnFull;
          return (
            <li key={p.playerId}>
              <button
                onClick={() => onToggle(p.playerId)}
                disabled={disabled}
                className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-2 text-[13px] ${
                  isSel ? t.selected : t.idle
                } ${disabled ? "opacity-40" : ""}`}
              >
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="flex w-full items-center gap-1">
                    {isSel && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold text-white ${t.badge}`}
                      >
                        {slotLabels[p.playerId]}
                      </span>
                    )}
                    <span
                      className={`shrink-0 rounded px-1 text-[10px] font-semibold ${ROLE_BADGE_COLOR[p.role]}`}
                    >
                      {roleTag(p.role)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">
                      {displayName(p)}
                    </span>
                  </span>
                  <span
                    className="text-[10px]"
                    style={{ color: benchGapColor(benchGap[p.playerId] ?? 0) }}
                  >
                    {justPlayedIds.has(p.playerId)
                      ? "Just played"
                      : `Last played ${benchGap[p.playerId] ?? 0} pts ago`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end text-[10px] text-faint">
                  <span>{pointsPlayed[p.playerId] ?? 0} pts</span>
                  <span>{Math.round((secondsPlayed[p.playerId] ?? 0) / 60)} min</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Injuries (between-points management) ────────────────────────────────────────

// Shown between points (awaiting_line): a strip of currently-injured players with
// a one-tap Clear, plus a collapsible manager to toggle ANY roster player injured
// or healthy — no forced hot-sub needed here since nobody's on the field yet.
function InjuryManager({
  roster,
  onToggle,
}: {
  roster: RosterSnapshotEntry[];
  onToggle: (playerId: string, injured: boolean) => void;
}) {
  const sorted = sortRoster(roster);
  const injured = sorted.filter((p) => p.injured);

  return (
    <div className="space-y-2">
      {injured.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-2">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Injured — locked out
          </p>
          <div className="flex flex-wrap gap-2">
            {injured.map((p) => (
              <span
                key={p.playerId}
                className="flex items-center gap-1.5 rounded-full border border-amber-300 dark:border-amber-500/40 bg-surface py-0.5 pl-2.5 pr-1 text-sm"
              >
                <span
                  className={p.genderMatch === "MMP" ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"}
                >
                  {p.genderMatch}
                </span>
                {displayName(p)}
                <button
                  onClick={() => onToggle(p.playerId, false)}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:bg-emerald-500/10"
                >
                  Clear
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <details className="rounded-lg border border-line p-2 text-sm">
        <summary className="cursor-pointer font-medium text-muted">
          Manage injuries
        </summary>
        <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {sorted.map((p) => (
            <li
              key={p.playerId}
              className="flex items-center justify-between rounded-md border border-line px-2 py-1"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={p.genderMatch === "MMP" ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"}
                >
                  {p.genderMatch}
                </span>
                {displayName(p)}
              </span>
              <button
                onClick={() => onToggle(p.playerId, !p.injured)}
                className={`rounded px-2 py-0.5 text-xs ${
                  p.injured
                    ? "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200"
                    : "text-faint hover:text-amber-700 dark:text-amber-300"
                }`}
              >
                {p.injured ? "Injured" : "Healthy"}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

// ── Saved lines (quick-fill) ────────────────────────────────────────────────────

function TagFilterChip({
  label,
  active,
  onClick,
  activeClassName,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Override the default emerald active style — e.g. a per-tag color
   *  (see SITUATION_TAG_COLOR). */
  activeClassName?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2 py-0.5 ${
        active
          ? activeClassName ??
            "border-emerald-500 bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-line-strong text-faint"
      }`}
    >
      {label}
    </button>
  );
}

interface QuickLine {
  line: SavedLine;
  mmp: number;
  wmp: number;
}

function SavedLinesBar({
  lines,
  appliedIds,
  justPlayedId,
  ratioLabel,
  onApply,
  note,
  open,
  onOpenChange,
  tagFilter,
  onTagFilterChange,
  filterTags,
}: {
  lines: QuickLine[];
  appliedIds: Set<string>;
  justPlayedId: string | null;
  /** Null for a non-mixed game, where there's no ratio to qualify by. */
  ratioLabel: string | null;
  onApply: (line: SavedLine) => void;
  note: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "all" for no filter, otherwise one of `filterTags`. */
  tagFilter: string;
  onTagFilterChange: (tag: string) => void;
  /** Situational tags plus this tournament's own custom ones. */
  filterTags: string[];
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
      className="rounded-lg border border-line p-2"
    >
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-faint">
        Quick lines{ratioLabel ? ` · ${ratioLabel}` : ""}
      </summary>

      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <TagFilterChip
            label="All"
            active={tagFilter === "all"}
            onClick={() => onTagFilterChange("all")}
          />
          {filterTags.map((t) => (
            <TagFilterChip
              key={t}
              label={t}
              active={tagFilter === t}
              onClick={() => onTagFilterChange(t)}
              activeClassName={SITUATION_TAG_COLOR[t as SituationTag]}
            />
          ))}
        </div>
        {lines.length === 0 ? (
          <p className="text-xs text-faint">
            {tagFilter === "all"
              ? "No saved lines or pods fit this ratio yet."
              : `No lines/pods tagged "${tagFilter}" fit this ratio.`}
          </p>
        ) : (
          // items-start so a chip with a "Just played" note doesn't stretch
          // every other chip in its row to match its height.
          <div className="flex flex-wrap items-start gap-2">
            {lines.map(({ line, mmp, wmp }) => {
              const isPod = line.playerIds.length < 7;
              const isApplied = appliedIds.has(line.id);
              const tone = line.color
                ? LINE_COLOR_CHIP[line.color]
                : isPod
                  ? "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300"
                  : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300";
              return (
                // The chip *is* the button — an inner button would only cover
                // its own line of text, leaving the rest of a taller chip
                // (e.g. one carrying a "Just played" note) dead to the touch.
                <button
                  key={line.id}
                  onClick={() => onApply(line)}
                  aria-pressed={isApplied}
                  title={isApplied ? "Tap to remove" : "Tap to apply"}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-1 text-left text-sm ${tone} ${
                    isApplied ? "ring-2 ring-offset-1 ring-offset-surface ring-current" : ""
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    {isApplied && <span aria-hidden>✓</span>}
                    {line.name}
                    <span className="text-[10px] font-normal opacity-70">
                      {isPod ? `pod` : "line"}
                      {line.side && line.side !== "both" ? ` · ${line.side}` : ""}
                      {" · "}
                      {mmp}M/{wmp}W · {line.useCount ?? 0}×
                    </span>
                  </span>
                  {line.id === justPlayedId && (
                    <span className="text-[10px] font-medium opacity-80">Just played</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {note && <p className="text-xs text-amber-600 dark:text-amber-400">{note}</p>}
      </div>
    </details>
  );
}

// Save the current selection as a reusable line/pod — sits directly above
// Confirm line, the natural moment to also bank a line for reuse.
function SaveLineButton({
  selectedCount,
  onSave,
}: {
  selectedCount: number;
  onSave: (name: string) => void;
}) {
  // `naming` is the "name input is open" toggle, not an in-flight flag —
  // actions.saveLine is fire-and-forget by design (best-effort on a sideline).
  // `submitted` is the double-tap guard: it's a ref because two taps in the
  // same frame both read the pre-render state.
  const [naming, setNaming] = useState(false);
  const submitted = useRef(false);
  const [name, setName] = useState("");
  const canSave = selectedCount >= 1 && selectedCount <= 7;

  if (!naming) {
    return (
      <button
        onClick={() => {
          submitted.current = false;
          setNaming(true);
        }}
        disabled={!canSave}
        className="w-full rounded-lg border border-dashed border-line-strong py-2 text-sm font-medium text-muted disabled:opacity-40"
      >
        + Save {selectedCount === 7 ? "line" : "pod"} ({selectedCount})
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={selectedCount === 7 ? "Line name (e.g. O-line)" : "Pod name (e.g. Handler core)"}
        className="flex-1 rounded border border-line-strong px-2 py-1.5 text-sm"
        autoFocus
      />
      <button
        onClick={() => {
          if (submitted.current) return;
          submitted.current = true;
          onSave(name.trim() || (selectedCount === 7 ? "Line" : "Pod"));
          setName("");
          setNaming(false);
        }}
        className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
      >
        Save
      </button>
      <button
        onClick={() => {
          setNaming(false);
          setName("");
        }}
        className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
      >
        Cancel
      </button>
    </div>
  );
}

// ── In-progress controls ────────────────────────────────────────────────────────

function InProgressControls({
  live,
  onNextLineDraftChange,
  replaySeed,
}: {
  live: LiveGame;
  onNextLineDraftChange: (ids: string[]) => void;
  replaySeed: { nonce: number; lineup: string[] } | null;
}) {
  const { game, roster, state, points, actions } = live;
  const nextPointNumber = state.currentPointNumber + 1;
  const nextGenderRatio = game.startingGenderRatio
    ? ratioForPoint(nextPointNumber, game.startingGenderRatio)
    : undefined;
  const currentLine = sortRoster(
    roster.filter((p) => state.currentLineup.includes(p.playerId)),
  );
  const currentPoint = points.find((p) => p.result === undefined);
  const pointStartedAt = currentPoint?.startedAt;
  const [scoringOpen, setScoringOpen] = useState(false);

  return (
    <div className="space-y-4">
      <PointClock startedAt={pointStartedAt} />

      <div className="grid grid-cols-2 gap-3">
        {/* "We scored" opens the goal/Callahan modal, which is what actually
            records the result — "they scored" has no detail to capture. */}
        <ScoreButton label="We scored ▸" onClick={() => setScoringOpen(true)} tone="emerald" />
        <ScoreButton label="They scored ▸" onClick={() => actions.recordResult("them")} tone="neutral" />
      </div>
      {scoringOpen && (
        <ScoringModal
          players={currentLine}
          onClose={() => setScoringOpen(false)}
          onRecord={(scoring) => {
            setScoringOpen(false);
            actions.recordResult("us", scoring);
          }}
        />
      )}

      <CurrentLineDisplay players={currentLine} />

      <StatRecorder
        players={currentLine}
        events={currentPoint?.statEvents ?? []}
        onAdd={actions.addStatEvent}
        onRemove={actions.removeStatEvent}
      />

      <InjuryFlow live={live} />

      <div className="space-y-3 border-t border-line pt-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Prepare next line <span className="font-normal text-faint">· Point {nextPointNumber}</span>
          </h2>
          {nextGenderRatio && <NextRatioBadge ratio={nextGenderRatio} />}
        </div>
        <LineBuilder
          live={live}
          seed={null}
          mode="prepare"
          pointNumber={nextPointNumber}
          genderRatio={nextGenderRatio}
          od={undefined}
          onSelectionChange={onNextLineDraftChange}
          replaySeed={replaySeed}
        />
      </div>
    </div>
  );
}

// ── Recorded stats (§ stats) ────────────────────────────────────────────────

const STAT_LABEL: Record<StatEventType, string> = {
  block: "Defensive block",
  turnover: "Turnover",
};

const STAT_TONE: Record<StatEventType, string> = {
  block: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300",
  turnover:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
};

/** Ds and turnovers for the point being played. Each tap opens a picker of
 *  whoever's actually on the field; recorded events are listed underneath so
 *  a mis-tap can be removed individually (the "edit" path). */
function StatRecorder({
  players,
  events,
  onAdd,
  onRemove,
}: {
  players: RosterSnapshotEntry[];
  events: StatEvent[];
  onAdd: (playerId: string, type: StatEventType) => void;
  onRemove: (eventId: string) => void;
}) {
  const [picking, setPicking] = useState<StatEventType | null>(null);
  const nameOf = (playerId: string) => {
    const p = players.find((x) => x.playerId === playerId);
    return p ? displayName(p) : "Unknown";
  };

  return (
    <div className="space-y-2 rounded-lg border border-line p-2">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">
        Record statistics
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setPicking("block")}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${STAT_TONE.block}`}
        >
          Defensive block
        </button>
        <button
          onClick={() => setPicking("turnover")}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${STAT_TONE.turnover}`}
        >
          Turnover
        </button>
      </div>

      {events.length > 0 && (
        <ul className="space-y-1">
          {events.map((ev) => (
            <li
              key={ev.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>
                <span
                  className={`mr-1.5 rounded border px-1 text-[10px] font-semibold uppercase ${STAT_TONE[ev.type]}`}
                >
                  {ev.type === "block" ? "D" : "T"}
                </span>
                {nameOf(ev.playerId)}
              </span>
              <button
                onClick={() => onRemove(ev.id)}
                aria-label={`Remove ${STAT_LABEL[ev.type]} for ${nameOf(ev.playerId)}`}
                className="shrink-0 rounded px-2 py-0.5 text-xs text-muted hover:text-fg"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {picking && (
        <PlayerPickerModal
          title={STAT_LABEL[picking]}
          players={players}
          onClose={() => setPicking(null)}
          onPick={(playerId) => {
            setPicking(null);
            onAdd(playerId, picking);
          }}
        />
      )}
    </div>
  );
}

/** Pick one of the players on the field. Used for Ds, turnovers, and each
 *  half of the goal/assist pair. */
function PlayerPickerModal({
  title,
  players,
  onClose,
  onPick,
  excludePlayerId,
  dismissLabel = "Cancel",
}: {
  title: string;
  players: RosterSnapshotEntry[];
  /** Also what a backdrop click does, so it always matches the button. */
  onClose: () => void;
  onPick: (playerId: string) => void;
  /** Hidden from the list — the assist thrower can't also catch the goal. */
  excludePlayerId?: string;
  dismissLabel?: string;
}) {
  const choices = players.filter((p) => p.playerId !== excludePlayerId);
  return (
    <Modal onClose={onClose}>
      <h2 className="font-medium">{title}</h2>
      <ul className="grid grid-cols-2 gap-1.5">
        {choices.map((p) => (
          <li key={p.playerId}>
            <button
              onClick={() => onPick(p.playerId)}
              className="w-full rounded-md border border-line px-2 py-2 text-left text-sm hover:border-line-strong"
            >
              <span
                className={`mr-1 rounded px-1 text-[10px] font-medium ${ROLE_BADGE_COLOR[p.role]}`}
              >
                {roleTag(p.role)}
              </span>
              {displayName(p)}
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={onClose}
        className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
      >
        {dismissLabel}
      </button>
    </Modal>
  );
}

/** Captures how we scored, on the way to recording the point. Every path ends
 *  in the point being recorded — including "Skip", so a coach who doesn't
 *  care about per-player credit isn't blocked from banking the score. */
function ScoringModal({
  players,
  onClose,
  onRecord,
}: {
  players: RosterSnapshotEntry[];
  onClose: () => void;
  onRecord: (scoring?: Scoring) => void;
}) {
  const [step, setStep] = useState<"kind" | "assist" | "goal" | "callahan">("kind");
  const [assistPlayerId, setAssistPlayerId] = useState<string | undefined>();

  if (step === "assist") {
    return (
      <PlayerPickerModal
        title="Who threw the assist?"
        players={players}
        dismissLabel="← Back"
        onClose={() => setStep("kind")}
        onPick={(id) => {
          setAssistPlayerId(id);
          setStep("goal");
        }}
      />
    );
  }
  if (step === "goal") {
    return (
      <PlayerPickerModal
        title="Who caught the goal?"
        players={players}
        excludePlayerId={assistPlayerId}
        dismissLabel="← Back"
        onClose={() => setStep("assist")}
        onPick={(goalPlayerId) =>
          onRecord({ kind: "goal", assistPlayerId, goalPlayerId })
        }
      />
    );
  }
  if (step === "callahan") {
    return (
      <PlayerPickerModal
        title="Who caught the Callahan?"
        players={players}
        dismissLabel="← Back"
        onClose={() => setStep("kind")}
        onPick={(playerId) => onRecord({ kind: "callahan", playerId })}
      />
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="font-medium">How did we score?</h2>
      <div className="grid gap-2">
        <button
          onClick={() => setStep("assist")}
          className="rounded-md border border-line px-3 py-2.5 text-left text-sm hover:border-line-strong"
        >
          <span className="font-medium">Goal</span>
          <span className="block text-xs text-muted">Record the assist and the score</span>
        </button>
        <button
          onClick={() => setStep("callahan")}
          className="rounded-md border border-line px-3 py-2.5 text-left text-sm hover:border-line-strong"
        >
          <span className="font-medium">Callahan</span>
          <span className="block text-xs text-muted">Blocked and caught in their end zone</span>
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-md border border-line-strong px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
        <button
          onClick={() => onRecord(undefined)}
          className="flex-1 rounded-md border border-line-strong px-3 py-1.5 text-sm"
        >
          Skip detail
        </button>
      </div>
    </Modal>
  );
}

// This point's own stopwatch: starts ticking the moment the line was
// confirmed (Point.startedAt), stops for good once the result is recorded —
// at that point this component unmounts along with the rest of
// InProgressControls, so there's nothing to freeze explicitly.
function PointClock({ startedAt }: { startedAt?: string }) {
  const now = useTicker(!!startedAt);
  if (!startedAt) return null;
  const elapsed = (now - new Date(startedAt).getTime()) / 1000;
  return (
    <div className="rounded-lg border border-line bg-surface-2 py-3 text-center">
      <p className="text-3xl font-bold tabular-nums">{formatClock(elapsed)}</p>
      <p className="text-xs uppercase tracking-wide text-faint">Point clock</p>
    </div>
  );
}

// Read-only display of who's on the field right now, so the coach doesn't
// have to scroll back up to the point log to remember while prepping the
// next line below.
function CurrentLineDisplay({ players }: { players: RosterSnapshotEntry[] }) {
  if (players.length === 0) return null;
  return (
    <div className="rounded-lg border border-line p-2">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-faint">
        Current line
      </p>
      <div className="flex flex-wrap gap-1.5 text-sm">
        {players.map((p) => (
          <span
            key={p.playerId}
            className={`rounded-full border px-2 py-0.5 ${
              p.genderMatch === "MMP" ? GENDER.MMP.idle : GENDER.WMP.idle
            }`}
          >
            {displayName(p)}
          </span>
        ))}
      </div>
    </div>
  );
}

// Same tone convention as the header's RatioBadge (sky = MMP majority, rose =
// WMP majority), just for the point after the one in progress.
function NextRatioBadge({ ratio }: { ratio: GenderRatio }) {
  const need = ratioCounts(ratio);
  const isMmpMajority = ratio === "4MMP_3WMP";
  const tone = isMmpMajority
    ? "bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-300"
    : "bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
      Next: {need.mmp} MMP / {need.wmp} WMP
    </span>
  );
}

function ScoreButton({
  label,
  onClick,
  tone,
}: {
  label: string;
  onClick: () => void;
  tone: "emerald" | "neutral";
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-600 text-white"
      : "bg-inverse text-inverse-fg";
  return (
    <button onClick={onClick} className={`rounded-lg py-4 font-semibold ${cls}`}>
      {label}
    </button>
  );
}

function InjuryFlow({ live }: { live: LiveGame }) {
  const { roster, state, actions } = live;
  const [injuredId, setInjuredId] = useState<string | null>(null);

  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const onField = new Set(state.currentLineup);
  // You can only injure someone currently on the field.
  const onFieldPlayers = state.currentLineup
    .map((id) => byId.get(id))
    .filter((p): p is RosterSnapshotEntry => p !== undefined);
  const injuredPlayer = injuredId ? byId.get(injuredId) : undefined;
  // Replacements: eligible players NOT already on the field, and matching the
  // injured player's gender match — a sub can't change the line's ratio.
  const replacements = sortRoster(
    roster.filter(
      (p) =>
        !p.injured &&
        isRosterActive(p) &&
        !onField.has(p.playerId) &&
        (!injuredPlayer || p.genderMatch === injuredPlayer.genderMatch),
    ),
  );

  if (!injuredId) {
    return (
      <details className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-amber-800 dark:text-amber-200">
          Injury — force a hot-sub
        </summary>
        <p className="mt-2 mb-1 text-amber-700 dark:text-amber-300">Who’s hurt?</p>
        <div className="flex flex-wrap gap-1.5">
          {onFieldPlayers.map((p) => (
            <button
              key={p.playerId}
              onClick={() => setInjuredId(p.playerId)}
              className="rounded border border-amber-300 dark:border-amber-500/40 bg-surface px-2 py-1"
            >
              {displayName(p)}
            </button>
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm">
      <p className="mb-1 font-medium text-amber-800 dark:text-amber-200">
        Replace {injuredPlayer ? displayName(injuredPlayer) : ""} with:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {replacements.length === 0 ? (
          <span className="text-amber-700 dark:text-amber-300">No eligible bench players.</span>
        ) : (
          replacements.map((p) => (
            <button
              key={p.playerId}
              onClick={() => {
                actions.injurySub(injuredId, p.playerId);
                setInjuredId(null);
              }}
              className="rounded border border-emerald-300 dark:border-emerald-500/40 bg-surface px-2 py-1"
            >
              {displayName(p)}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Secondary controls (always available) ────────────────────────────────────────

function SecondaryControls({ live }: { live: LiveGame }) {
  const { state, actions, canUndo, canRedo, undoLabel, redoLabel, points } = live;
  const [undoingFlip, setUndoingFlip] = useState(false);
  const [flipError, setFlipError] = useState<string | null>(null);

  const undoFlip = async () => {
    setUndoingFlip(true);
    setFlipError(null);
    try {
      await actions.undoFlip();
    } catch (err) {
      setFlipError(err instanceof Error ? err.message : String(err));
      setUndoingFlip(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex flex-wrap gap-2 text-sm">
        {state.currentPointNumber > 1 && state.phase !== "point_in_progress" && (
          <SmallButton
            label="Halftime"
            disabled={state.halftimeReached}
            onClick={actions.callHalftime}
          />
        )}
        <SmallButton
          label={`Timeout us (${state.ourTimeoutsRemaining})`}
          disabled={state.ourTimeoutsRemaining <= 0}
          onClick={() => actions.callTimeout("us")}
        />
        <SmallButton
          label={`Timeout them (${state.theirTimeoutsRemaining})`}
          disabled={state.theirTimeoutsRemaining <= 0}
          onClick={() => actions.callTimeout("them")}
        />
        {canUndo && <SmallButton label={undoLabel ?? "Undo"} onClick={actions.undo} />}
        {canRedo && <SmallButton label={redoLabel ?? "Redo"} onClick={actions.redo} />}
        {points.length === 0 && (
          <SmallButton
            label={undoingFlip ? "Undoing flip…" : "Undo flip"}
            disabled={undoingFlip}
            onClick={undoFlip}
          />
        )}
        <SmallButton label="End game" onClick={actions.endGame} />
      </div>
      {flipError && <p className="text-xs text-red-600 dark:text-red-400">{flipError}</p>}
    </div>
  );
}

function SmallButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-line-strong px-3 py-1.5 disabled:opacity-40"
    >
      {label}
    </button>
  );
}
