"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Player, SavedLine, Tournament } from "@shared/game-rules";
import { readPlayers } from "@/lib/storage/teams";
import { findTournament } from "@/lib/storage/tournaments";
import {
  createSavedLine,
  deleteSavedLine,
  readSavedLines,
  updateSavedLine,
} from "@/lib/storage/savedLines";
import { displayName, odTag, roleTag, sortByRole } from "@/lib/player-display";

// Build/edit reusable lines (7) and pods (1-6) for a team, reached from the
// tournament page. Saved lines are team-scoped (§4.3) so they show up in the
// live caller's quick-lines bar across every game for this team.
export function LinesEditor({ tournamentId }: { tournamentId: string }) {
  const [tournament, setTournament] = useState<Tournament | null | undefined>(
    undefined,
  );
  const [players, setPlayers] = useState<Player[]>([]);
  const [lines, setLines] = useState<SavedLine[]>([]);

  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    findTournament(tournamentId).then((t) => {
      setTournament(t);
      if (!t) return;
      readPlayers(t.teamId).then(setPlayers);
      readSavedLines(t.teamId).then(setLines);
    });
  }, [tournamentId]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

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

  const teamId = tournament.teamId;
  const refresh = () => readSavedLines(teamId).then(setLines);

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
    setEditingId(null);
  };

  const startEdit = (line: SavedLine) => {
    setSelected([...line.playerIds]);
    setName(line.name);
    setEditingId(line.id);
  };

  const save = async () => {
    if (!name.trim() || selected.length === 0) return;
    if (editingId) {
      await updateSavedLine(editingId, { name: name.trim(), playerIds: selected });
    } else {
      await createSavedLine(teamId, name.trim(), selected);
    }
    refresh();
    resetBuilder();
  };

  const remove = async (id: string) => {
    await deleteSavedLine(id);
    if (editingId === id) resetBuilder();
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
      <div className="space-y-3 rounded-lg border border-line-strong p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            {editingId ? "Editing" : "New"}{" "}
            <span className="text-faint">
              {selected.length}/7 · {mmp}M / {wmp}W
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

        {players.length === 0 ? (
          <p className="text-sm text-muted">No players on the team roster yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <PlayerColumn
              gender="MMP"
              players={sortByRole(players.filter((p) => p.genderMatch === "MMP"))}
              selected={selected}
              onToggle={toggle}
            />
            <PlayerColumn
              gender="WMP"
              players={sortByRole(players.filter((p) => p.genderMatch === "WMP"))}
              selected={selected}
              onToggle={toggle}
            />
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
            {lines.map((line) => {
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
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {line.name}{" "}
                      <span className="text-xs font-normal text-faint">
                        {isPod ? "pod" : "line"} · {c.mmp}M/{c.wmp}W · used{" "}
                        {line.useCount ?? 0}×
                      </span>
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(line)}
                        className="text-xs font-medium text-emerald-700 dark:text-emerald-400"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove(line.id)}
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
    </section>
  );
}

function PlayerColumn({
  gender,
  players,
  selected,
  onToggle,
}: {
  gender: "MMP" | "WMP";
  players: Player[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const tone =
    gender === "MMP"
      ? {
          header: "text-sky-600 dark:text-sky-400",
          idle: "border-sky-200 dark:border-sky-500/30",
          selected: "border-sky-500 bg-sky-50 dark:bg-sky-500/10 font-medium",
        }
      : {
          header: "text-rose-600 dark:text-rose-400",
          idle: "border-rose-200 dark:border-rose-500/30",
          selected: "border-rose-500 bg-rose-50 dark:bg-rose-500/10 font-medium",
        };
  return (
    <div>
      <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${tone.header}`}>
        {gender}
      </p>
      <ul className="space-y-1">
        {players.map((p) => {
          const isSel = selected.includes(p.id);
          return (
            <li key={p.id}>
              <button
                onClick={() => onToggle(p.id)}
                className={`flex w-full items-center gap-1 rounded-md border px-2 py-1.5 text-left text-[13px] ${
                  isSel ? tone.selected : tone.idle
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
