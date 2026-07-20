"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  LineColor,
  ODPreference,
  Player,
  SavedLine,
  Tournament,
} from "@shared/game-rules";
import { readPlayers } from "@/lib/storage/teams";
import { findTournament } from "@/lib/storage/tournaments";
import {
  createSavedLine,
  deleteSavedLine,
  readSavedLines,
  updateSavedLine,
} from "@/lib/storage/savedLines";
import {
  LINE_COLOR_SWATCH,
  LINE_COLORS,
  displayName,
  odTag,
  roleTag,
  sortRoster,
} from "@/lib/player-display";
import { Modal } from "@/components/modal";

// Build/edit reusable lines (7) and pods (1-6), reached from the tournament
// page. Saved lines are tournament-scoped (§4.3) so they show up in the live
// caller's quick-lines bar only for games under this specific tournament.
export function LinesEditor({ tournamentId }: { tournamentId: string }) {
  const [tournament, setTournament] = useState<Tournament | null | undefined>(
    undefined,
  );
  const [players, setPlayers] = useState<Player[]>([]);
  const [lines, setLines] = useState<SavedLine[]>([]);

  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState<LineColor | null>(null);
  const [side, setSide] = useState<ODPreference>("both");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SavedLine | null>(null);

  useEffect(() => {
    findTournament(tournamentId).then((t) => {
      setTournament(t);
      if (!t) return;
      readPlayers(t.teamId).then(setPlayers);
      readSavedLines(tournamentId).then(setLines);
    });
  }, [tournamentId]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  // Grouped by color (in the same canonical order as the swatch picker,
  // uncolored lines last), then alphabetically by name within a color.
  const sortedLines = useMemo(() => {
    const colorRank = (c: LineColor | undefined) =>
      c ? LINE_COLORS.indexOf(c) : LINE_COLORS.length;
    return [...lines].sort(
      (a, b) =>
        colorRank(a.color) - colorRank(b.color) ||
        a.name.localeCompare(b.name),
    );
  }, [lines]);

  if (tournament === undefined) return <p className="text-muted">Loading…</p>;
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

  const refresh = () => readSavedLines(tournamentId).then(setLines);

  const composition = (playerIds: string[]) => {
    let mmp = 0;
    let wmp = 0;
    for (const id of playerIds) {
      const g = byId.get(id)?.genderMatch;
      if (g === "MMP") mmp++;
      else if (g === "WMP") wmp++;
    }
    return { mmp, wmp };
  };

  const toggle = (id: string) =>
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 7) return cur; // a line/pod is at most a full line
      return [...cur, id];
    });

  const resetBuilder = () => {
    setSelected([]);
    setName("");
    setColor(null);
    setSide("both");
    setEditingId(null);
  };

  const startEdit = (line: SavedLine) => {
    setSelected([...line.playerIds]);
    setName(line.name);
    setColor(line.color ?? null);
    setSide(line.side ?? "both");
    setEditingId(line.id);
    document
      .getElementById("line-builder")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const save = async () => {
    if (!name.trim() || selected.length === 0) return;
    if (editingId) {
      await updateSavedLine(editingId, {
        name: name.trim(),
        playerIds: selected,
        color,
        side,
      });
    } else {
      await createSavedLine(tournamentId, name.trim(), selected, { color, side });
    }
    refresh();
    resetBuilder();
  };

  const confirmRemove = async () => {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    await deleteSavedLine(id);
    if (editingId === id) resetBuilder();
    refresh();
  };

  const toggleHidden = async (line: SavedLine) => {
    await updateSavedLine(line.id, { hidden: !line.hidden });
    refresh();
  };

  const { mmp, wmp } = composition(selected);
  const canSave = name.trim().length > 0 && selected.length > 0;

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/tournaments/${tournamentId}`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
        >
          <span aria-hidden>←</span> {tournament.name}
        </Link>
        <h1 className="text-xl font-semibold">Lines & pods</h1>
        <p className="text-sm text-muted">
          Build reusable lines (7) or pods (1-6) for the team roster. They show up
          as quick-fill options in the live caller for any game.
        </p>
      </div>

      {/* Builder */}
      <div id="line-builder" className="space-y-3 rounded-lg border border-line-strong p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            {editingId ? "Editing" : "New"}{" "}
            <span className="text-faint">
              {selected.length}/7
              {tournament.division === "mixed" && ` · ${mmp}M / ${wmp}W`}
            </span>
          </p>
          {editingId && (
            <button
              onClick={resetBuilder}
              className="text-xs font-medium text-muted hover:text-fg"
            >
              Cancel edit
            </button>
          )}
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={selected.length === 7 ? "Line name (e.g. O-line)" : "Pod name (e.g. Handler core)"}
          className="w-full rounded border border-line-strong px-2 py-1.5 text-sm"
        />

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-faint">Color</span>
            <button
              onClick={() => setColor(null)}
              aria-label="No color"
              aria-pressed={color === null}
              className={`h-5 w-5 rounded-full border-2 border-dashed ${
                color === null ? "border-fg" : "border-line-strong"
              }`}
            />
            {LINE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={c}
                aria-pressed={color === c}
                className={`h-5 w-5 rounded-full ${LINE_COLOR_SWATCH[c]} ${
                  color === c ? "ring-2 ring-offset-1 ring-offset-surface ring-fg" : ""
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-faint">Side</span>
            {(["O", "D", "both"] as const).map((s) => (
              <ToggleButton
                key={s}
                label={s === "both" ? "O/D" : s}
                active={side === s}
                onClick={() => setSide(s)}
              />
            ))}
          </div>
        </div>

        {players.length === 0 ? (
          <p className="text-sm text-muted">No players on the team roster yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {tournament.division === "mixed" ? (
              <>
                <PlayerColumn
                  label="MMP"
                  tone="sky"
                  players={sortRoster(players.filter((p) => p.genderMatch === "MMP"))}
                  selected={selected}
                  onToggle={toggle}
                />
                <PlayerColumn
                  label="WMP"
                  tone="rose"
                  players={sortRoster(players.filter((p) => p.genderMatch === "WMP"))}
                  selected={selected}
                  onToggle={toggle}
                />
              </>
            ) : (
              (() => {
                const sorted = sortRoster(players);
                const mid = Math.ceil(sorted.length / 2);
                const tone = tournament.division === "open" ? "sky" : "rose";
                return (
                  <>
                    <PlayerColumn
                      tone={tone}
                      players={sorted.slice(0, mid)}
                      selected={selected}
                      onToggle={toggle}
                    />
                    <PlayerColumn
                      tone={tone}
                      players={sorted.slice(mid)}
                      selected={selected}
                      onToggle={toggle}
                    />
                  </>
                );
              })()
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={!canSave}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:bg-disabled"
          >
            {editingId ? "Save changes" : "Create"}
          </button>
          {selected.length > 0 && (
            <button
              onClick={() => setSelected([])}
              className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
            >
              Clear selection
            </button>
          )}
        </div>
      </div>

      {/* Existing lines & pods */}
      <div className="space-y-2">
        <h2 className="font-medium">Saved ({lines.length})</h2>
        {lines.length === 0 ? (
          <p className="text-sm text-muted">No saved lines or pods yet.</p>
        ) : (
          <ul className="space-y-2">
            {sortedLines.map((line) => {
              const c = composition(line.playerIds);
              const isPod = line.playerIds.length < 7;
              const names = line.playerIds
                .map((id) => byId.get(id))
                .filter((p): p is Player => !!p)
                .map((p) => displayName(p));
              return (
                <li
                  key={line.id}
                  className={`space-y-1 rounded-lg border p-3 text-sm ${
                    isPod
                      ? "border-violet-300 dark:border-violet-500/40"
                      : "border-emerald-300 dark:border-emerald-500/40"
                  } ${line.hidden ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium">
                      {line.color && (
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${LINE_COLOR_SWATCH[line.color]}`}
                          aria-hidden
                        />
                      )}
                      {line.name}{" "}
                      <span className="text-xs font-normal text-faint">
                        {isPod ? "pod" : "line"} · {odTag(line.side)} · {c.mmp}M/
                        {c.wmp}W · used {line.useCount ?? 0}×
                        {line.hidden ? " · hidden" : ""}
                      </span>
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleHidden(line)}
                        className="text-xs font-medium text-muted hover:text-fg"
                      >
                        {line.hidden ? "Show line" : "Hide line"}
                      </button>
                      <button
                        onClick={() => startEdit(line)}
                        className="text-xs font-medium text-emerald-700 dark:text-emerald-400"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting(line)}
                        className="text-xs font-medium text-red-600 dark:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="text-faint">{names.join(", ")}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {deleting && (
        <Modal onClose={() => setDeleting(null)}>
          <h2 className="font-medium">
            Delete {deleting.playerIds.length < 7 ? "pod" : "line"}?
          </h2>
          <p className="text-sm text-muted">
            Are you sure you want to delete “{deleting.name}”? This can’t be
            undone.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setDeleting(null)}
              className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={confirmRemove}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function ToggleButton({
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
      className={`rounded-full border px-2 py-0.5 text-xs ${
        active
          ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-line-strong text-faint"
      }`}
    >
      {label}
    </button>
  );
}

const COLUMN_TONE = {
  sky: {
    header: "text-sky-600 dark:text-sky-400",
    idle: "border-sky-200 dark:border-sky-500/30",
    selected: "border-sky-500 bg-sky-50 dark:bg-sky-500/10 font-medium",
  },
  rose: {
    header: "text-rose-600 dark:text-rose-400",
    idle: "border-rose-200 dark:border-rose-500/30",
    selected: "border-rose-500 bg-rose-50 dark:bg-rose-500/10 font-medium",
  },
} as const;

function PlayerColumn({
  label,
  tone,
  players,
  selected,
  onToggle,
}: {
  /** Omitted for a single-division team, where MMP/WMP is redundant. */
  label?: string;
  tone: keyof typeof COLUMN_TONE;
  players: Player[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const t = COLUMN_TONE[tone];
  return (
    <div>
      {label && (
        <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${t.header}`}>
          {label}
        </p>
      )}
      <ul className="space-y-1">
        {players.map((p) => {
          const isSel = selected.includes(p.id);
          return (
            <li key={p.id}>
              <button
                onClick={() => onToggle(p.id)}
                className={`flex w-full items-center gap-1 rounded-md border px-2 py-1.5 text-left text-[13px] ${
                  isSel ? t.selected : t.idle
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{displayName(p)}</span>
                <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] font-medium text-muted">
                  {roleTag(p.role)}
                </span>
                <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] font-medium text-muted">
                  {odTag(p.odPreference)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
