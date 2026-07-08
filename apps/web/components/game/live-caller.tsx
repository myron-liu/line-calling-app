"use client";

import { useEffect, useMemo, useState } from "react";
import {
  genderStateLabel,
  ratioCounts,
  validateLine,
  type GenderRatio,
  type PointResult,
  type SavedLine,
} from "@shared/game-rules";
import type { LiveGame } from "@/lib/game/useLiveGame";
import { isRosterActive, type RosterSnapshotEntry } from "@/lib/storage/gameLog";
import {
  LINE_COLOR_CHIP,
  ROLE_BADGE_COLOR,
  displayName,
  roleTag,
  sortRoster,
} from "@/lib/player-display";

// The live line caller (§8). Drives the engine hook; only reads/writes localStorage.
export function LiveCaller({ live }: { live: LiveGame }) {
  const { game, roster, state, carryOver, actions, error } = live;

  return (
    <div className="space-y-4">
      <Header live={live} />
      {error && (
        <p className="rounded-md bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {state.phase === "awaiting_line" && (
        <LineBuilder live={live} key={`p${state.currentPointNumber}`} seed={carryOver} />
      )}
      {state.phase === "point_in_progress" && <InProgressControls live={live} />}

      <SecondaryControls live={live} />
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────────

function Header({ live }: { live: LiveGame }) {
  const { state, game } = live;
  const odColor = state.od === "O" ? "bg-sky-600" : "bg-orange-600";
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
      </div>
      {game.startingGenderRatio && (
        <GenderCycle
          startA={game.startingGenderRatio}
          currentPoint={state.currentPointNumber}
        />
      )}
    </div>
  );
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

type SortMode = "roster" | "recency" | "playtime";

function LineBuilder({
  live,
  seed,
}: {
  live: LiveGame;
  seed: string[] | null;
}) {
  const { game, roster, state, savedLines, actions } = live;
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

  // Split eligible players by O/D preference for the two accordions below.
  // "both" and unset (no preference recorded) show up in both groups.
  const oGroup = useMemo(
    () => eligible.filter((p) => p.odPreference !== "D"),
    [eligible],
  );
  const dGroup = useMemo(
    () => eligible.filter((p) => p.odPreference !== "O"),
    [eligible],
  );
  const oIds = useMemo(() => new Set(oGroup.map((p) => p.playerId)), [oGroup]);
  const dIds = useMemo(() => new Set(dGroup.map((p) => p.playerId)), [dGroup]);

  // Points sat out since each player's last start (never-played = all completed
  // points so far). Flags long benches in the roster columns below.
  const benchGap = useMemo(() => {
    const completed = state.currentPointNumber - 1;
    const gaps: Record<string, number> = {};
    for (const p of roster) {
      gaps[p.playerId] = completed - (state.lastPlayedPoint[p.playerId] ?? 0);
    }
    return gaps;
  }, [roster, state.lastPlayedPoint, state.currentPointNumber]);

  // Selectable slots per gender: the ratio in Mixed, otherwise up to a full line.
  const need = state.genderRatio ? ratioCounts(state.genderRatio) : null;
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
  // can open it programmatically after the initial render.
  const [openSections, setOpenSections] = useState({
    O: state.od === "O",
    D: state.od === "D",
  });
  // Prune anyone who becomes ineligible (e.g. marked injured mid-build) without
  // resetting the rest of the pick — this only fires within the same point, since
  // a new point remounts LineBuilder via its `key` and re-seeds from scratch.
  useEffect(() => {
    setSelected((cur) => cur.filter((id) => eligibleIds.has(id)));
  }, [eligibleIds]);

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

  const result = validateLine({
    division: game.startingGenderRatio ? "mixed" : "open",
    requiredRatio: state.genderRatio,
    players: selectedPlayers,
    eligiblePlayerIds: eligibleIds,
  });

  const totalReached = selected.length >= 7;
  const mmpFull = totalReached || result.mmp >= maxMMP;
  const wmpFull = totalReached || result.wmp >= maxWMP;

  // Quick lines that fit this point: full lines whose composition matches the ratio
  // exactly, plus partial pods whose composition fits under the point's gender caps.
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
  // Lines/pods tagged for the current point's side sort first (untagged/"both"
  // in the middle, the opposite side last), so the relevant quick-fills are
  // right there without scanning past ones for the other side.
  const sideMatchRank = (lineSide: SavedLine["side"]): number => {
    if (lineSide === state.od) return 0;
    if (!lineSide || lineSide === "both") return 1;
    return 2;
  };

  // A line/pod fits if its MMP and WMP counts each stay within the point's caps.
  // For a full 7 this forces an exact ratio match; for a pod it just has to fit.
  const quickLines = savedLines
    .map((line) => ({ line, ...composition(line.playerIds) }))
    .filter(
      (x) =>
        x.line.playerIds.length >= 1 &&
        x.line.playerIds.length <= 7 &&
        x.mmp <= maxMMP &&
        x.wmp <= maxWMP,
    )
    .sort((a, b) => {
      const side = sideMatchRank(a.line.side) - sideMatchRank(b.line.side);
      if (side !== 0) return side;
      return b.line.playerIds.length - a.line.playerIds.length;
    });

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
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {selected.length}/7 selected
          <span className="ml-2">
            <span className={GENDER.MMP.headerText}>
              MMP {result.mmp}/{maxMMP}
            </span>
            <span className="text-faint"> · </span>
            <span className={GENDER.WMP.headerText}>
              WMP {result.wmp}/{maxWMP}
            </span>
          </span>
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

      <SavedLinesBar
        lines={quickLines}
        appliedIds={appliedLineIds}
        ratioLabel={need ? `${maxMMP}M / ${maxWMP}W` : "any 7"}
        onApply={applyLine}
        note={applyNote}
      />

      <InjuryManager
        roster={roster.filter(isRosterActive)}
        onToggle={(id, injured) => actions.setInjured(id, injured)}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-faint">Sort:</span>
        <SortToggleButton
          label="Roster"
          active={sortMode === "roster"}
          onClick={() => setSortMode("roster")}
        />
        <SortToggleButton
          label="Least recently played"
          active={sortMode === "recency"}
          onClick={() => setSortMode("recency")}
        />
        <SortToggleButton
          label="Least points played"
          active={sortMode === "playtime"}
          onClick={() => setSortMode("playtime")}
        />
      </div>

      <ODAccordion
        label="Offense"
        tone="O"
        open={openSections.O}
        onOpenChange={(open) => setOpenSections((s) => ({ ...s, O: open }))}
        players={oGroup}
        selected={selected}
        slotLabels={slotLabels}
        pointsPlayed={state.pointsPlayed}
        benchGap={benchGap}
        sortMode={sortMode}
        mmpFull={mmpFull}
        wmpFull={wmpFull}
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
        pointsPlayed={state.pointsPlayed}
        benchGap={benchGap}
        sortMode={sortMode}
        mmpFull={mmpFull}
        wmpFull={wmpFull}
        onToggle={toggle}
      />

      <SaveLineButton
        selectedCount={selected.length}
        onSave={(name) => actions.saveLine(name, selected)}
      />

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
  benchGap,
  sortMode,
  mmpFull,
  wmpFull,
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
  benchGap: Record<string, number>;
  sortMode: SortMode;
  mmpFull: boolean;
  wmpFull: boolean;
  onToggle: (id: string) => void;
}) {
  const t = OD_ACCORDION_TONE[tone];
  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
      className={`rounded-lg border p-2 ${t.border}`}
    >
      <summary className={`cursor-pointer text-sm font-semibold ${t.text}`}>
        {label} <span className="font-normal text-faint">({players.length})</span>
      </summary>
      <div className="mt-2">
        <GenderColumns
          players={players}
          selected={selected}
          slotLabels={slotLabels}
          pointsPlayed={pointsPlayed}
          benchGap={benchGap}
          sortMode={sortMode}
          mmpFull={mmpFull}
          wmpFull={wmpFull}
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

/** Fewest total points played first; ties broken by name. */
function sortByFewestPlayed<T extends RosterSnapshotEntry>(
  players: T[],
  pointsPlayed: Record<string, number>,
): T[] {
  return [...players].sort((a, b) => {
    const diff = (pointsPlayed[a.playerId] ?? 0) - (pointsPlayed[b.playerId] ?? 0);
    if (diff !== 0) return diff;
    return displayName(a).localeCompare(displayName(b));
  });
}

function GenderColumns({
  players,
  selected,
  slotLabels,
  pointsPlayed,
  benchGap,
  sortMode,
  mmpFull,
  wmpFull,
  onToggle,
}: {
  players: RosterSnapshotEntry[];
  selected: string[];
  slotLabels: Record<string, string>;
  pointsPlayed: Record<string, number>;
  benchGap: Record<string, number>;
  sortMode: SortMode;
  mmpFull: boolean;
  wmpFull: boolean;
  onToggle: (id: string) => void;
}) {
  const sort =
    sortMode === "recency"
      ? (list: RosterSnapshotEntry[]) => sortByRecency(list, benchGap)
      : sortMode === "playtime"
        ? (list: RosterSnapshotEntry[]) => sortByFewestPlayed(list, pointsPlayed)
        : sortRoster;
  return (
    <div className="grid grid-cols-2 gap-3">
      <RosterColumn
        gender="MMP"
        players={sort(players.filter((p) => p.genderMatch === "MMP"))}
        selected={selected}
        slotLabels={slotLabels}
        pointsPlayed={pointsPlayed}
        benchGap={benchGap}
        columnFull={mmpFull}
        onToggle={onToggle}
      />
      <RosterColumn
        gender="WMP"
        players={sort(players.filter((p) => p.genderMatch === "WMP"))}
        selected={selected}
        slotLabels={slotLabels}
        pointsPlayed={pointsPlayed}
        benchGap={benchGap}
        columnFull={wmpFull}
        onToggle={onToggle}
      />
    </div>
  );
}

function RosterColumn({
  gender,
  players,
  selected,
  slotLabels,
  pointsPlayed,
  benchGap,
  columnFull,
  onToggle,
}: {
  gender: "MMP" | "WMP";
  players: RosterSnapshotEntry[];
  selected: string[];
  slotLabels: Record<string, string>;
  pointsPlayed: Record<string, number>;
  benchGap: Record<string, number>;
  columnFull: boolean;
  onToggle: (id: string) => void;
}) {
  const tone = GENDER[gender];
  return (
    <div>
      <p
        className={`mb-1 text-xs font-semibold uppercase tracking-wide ${tone.headerText}`}
      >
        {tone.label}
      </p>
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
                  isSel ? tone.selected : tone.idle
                } ${disabled ? "opacity-40" : ""}`}
              >
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="flex w-full items-center gap-1">
                    {isSel && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold text-white ${tone.badge}`}
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
                    Last played {benchGap[p.playerId] ?? 0} points ago
                  </span>
                </span>
                <span className="shrink-0 text-xs text-faint">
                  {pointsPlayed[p.playerId] ?? 0}
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

interface QuickLine {
  line: SavedLine;
  mmp: number;
  wmp: number;
}

function SavedLinesBar({
  lines,
  appliedIds,
  ratioLabel,
  onApply,
  note,
}: {
  lines: QuickLine[];
  appliedIds: Set<string>;
  ratioLabel: string;
  onApply: (line: SavedLine) => void;
  note: string | null;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-line p-2">
      <span className="text-xs font-medium uppercase tracking-wide text-faint">
        Quick lines · {ratioLabel}
      </span>

      {lines.length === 0 ? (
        <p className="text-xs text-faint">
          No saved lines or pods fit this ratio yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {lines.map(({ line, mmp, wmp }) => {
            const isPod = line.playerIds.length < 7;
            const isApplied = appliedIds.has(line.id);
            const tone = line.color
              ? LINE_COLOR_CHIP[line.color]
              : isPod
                ? "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300"
                : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300";
            return (
              <span
                key={line.id}
                className={`flex items-center gap-1 rounded-full border py-1 pl-3 pr-3 text-sm ${tone} ${
                  isApplied ? "ring-2 ring-offset-1 ring-offset-surface ring-current" : ""
                }`}
              >
                <button
                  onClick={() => onApply(line)}
                  aria-pressed={isApplied}
                  title={isApplied ? "Tap to remove" : "Tap to apply"}
                  className="flex items-center gap-1.5 font-medium"
                >
                  {isApplied && <span aria-hidden>✓</span>}
                  {line.name}
                  <span className="text-[10px] font-normal opacity-70">
                    {isPod ? `pod` : "line"}
                    {line.side && line.side !== "both" ? ` · ${line.side}` : ""}
                    {" · "}
                    {mmp}M/{wmp}W · {line.useCount ?? 0}×
                  </span>
                </button>
              </span>
            );
          })}
        </div>
      )}

      {note && <p className="text-xs text-amber-600 dark:text-amber-400">{note}</p>}
    </div>
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
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const canSave = selectedCount >= 1 && selectedCount <= 7;

  if (!saving) {
    return (
      <button
        onClick={() => setSaving(true)}
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
          onSave(name.trim() || (selectedCount === 7 ? "Line" : "Pod"));
          setName("");
          setSaving(false);
        }}
        className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
      >
        Save
      </button>
      <button
        onClick={() => {
          setSaving(false);
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

function InProgressControls({ live }: { live: LiveGame }) {
  const { actions } = live;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <ScoreButton label="We scored ▸" onClick={() => actions.recordResult("us")} tone="emerald" />
        <ScoreButton label="They scored ▸" onClick={() => actions.recordResult("them")} tone="neutral" />
      </div>
      <InjuryFlow live={live} />
    </div>
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
  const { state, actions, canUndo, canRedo } = live;
  return (
    <div className="flex flex-wrap gap-2 border-t border-line pt-3 text-sm">
      {state.currentPointNumber > 1 && (
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
      {canUndo && <SmallButton label="Undo" onClick={actions.undo} />}
      {canRedo && <SmallButton label="Redo" onClick={actions.redo} />}
      <SmallButton label="End game" onClick={actions.endGame} />
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
