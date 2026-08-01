"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Player, Team } from "@shared/game-rules";
import { readPlayers, readTeam, updatePlayer } from "@/lib/storage/teams";
import { sortRoster } from "@/lib/player-display";
import { Modal } from "@/components/modal";
import { COLUMN_TONE, PlayerColumn } from "./lines-editor";

// Quick player tagging, mirroring the lines/pods editor's shape: pick or
// create a tag, then toggle roster membership straight from a roster grid —
// no per-player modal round-trip. Player.tags is team-wide (unlike saved
// lines, which are tournament-scoped), so this reads/writes the whole
// team's roster directly.
export function PlayerTagsEditor({ teamId }: { teamId: string }) {
  const [team, setTeam] = useState<Team | null | undefined>(undefined);
  const [players, setPlayers] = useState<Player[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [deletingTag, setDeletingTag] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readTeam(teamId).then((t) => {
      setTeam(t);
      if (t) readPlayers(teamId).then(setPlayers);
    });
  }, [teamId]);

  const refresh = () => readPlayers(teamId).then(setPlayers);

  // Every tag currently in use, with how many players carry it — the tag
  // itself has no separate record, it just exists as long as someone has it.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of players) {
      for (const t of p.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [players]);
  const allTags = useMemo(
    () => [...tagCounts.keys()].sort((a, b) => a.localeCompare(b)),
    [tagCounts],
  );

  if (team === undefined) return <p className="text-muted">Loading…</p>;
  if (team === null) {
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-muted">Team not found.</p>
        <Link href="/teams" className="text-sm text-emerald-700 dark:text-emerald-400 underline">
          Back to teams
        </Link>
      </div>
    );
  }

  const selectTag = (tag: string) => {
    setActiveTag(tag);
    setError(null);
  };

  const createTag = () => {
    const t = newTagInput.trim();
    if (!t) return;
    // Not persisted until the first player is toggled onto it — matches
    // "a tag exists as long as someone has it" (see Player.tags).
    setActiveTag(t);
    setNewTagInput("");
    setError(null);
  };

  const toggleMember = async (player: Player) => {
    if (!activeTag) return;
    const has = (player.tags ?? []).includes(activeTag);
    const nextTags = has
      ? (player.tags ?? []).filter((t) => t !== activeTag)
      : [...(player.tags ?? []), activeTag];
    setBusyId(player.id);
    setError(null);
    try {
      await updatePlayer(player.id, { tags: nextTags });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDeleteTag = async () => {
    if (!deletingTag) return;
    const tag = deletingTag;
    setDeletingTag(null);
    setError(null);
    try {
      await Promise.all(
        players
          .filter((p) => p.tags?.includes(tag))
          .map((p) => updatePlayer(p.id, { tags: p.tags!.filter((t) => t !== tag) })),
      );
      if (activeTag === tag) setActiveTag(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const members = activeTag
    ? new Set(players.filter((p) => p.tags?.includes(activeTag)).map((p) => p.id))
    : new Set<string>();

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/teams/${teamId}`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
        >
          <span aria-hidden>←</span> {team.name}
        </Link>
        <h1 className="text-xl font-semibold">Player tags</h1>
        <p className="text-sm text-muted">
          Tag players with custom labels (e.g. &ldquo;Zone D specialist&rdquo;) —
          filterable in the live caller&rsquo;s line builder.
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-line-strong p-3">
        <p className="text-sm font-medium">Tags</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => selectTag(tag)}
              aria-pressed={activeTag === tag}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                activeTag === tag
                  ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "border-line-strong text-faint"
              }`}
            >
              {tag} <span className="text-faint">({tagCounts.get(tag)})</span>
            </button>
          ))}
          <input
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                createTag();
              }
            }}
            placeholder="New tag…"
            className="min-w-[7rem] flex-1 rounded border border-line-strong px-2 py-1 text-xs"
          />
          <button
            onClick={createTag}
            disabled={!newTagInput.trim()}
            className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:bg-disabled"
          >
            Add
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {!activeTag ? (
        <p className="text-sm text-muted">
          Pick a tag above, or create a new one, to start assigning it to players.
        </p>
      ) : (
        <div className="space-y-3 rounded-lg border border-line-strong p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Assign &ldquo;{activeTag}&rdquo;{" "}
              <span className="text-faint">({members.size} players)</span>
            </p>
            <button
              onClick={() => setDeletingTag(activeTag)}
              className="text-xs font-medium text-red-600 hover:opacity-80 dark:text-red-400"
            >
              Delete tag
            </button>
          </div>

          {players.length === 0 ? (
            <p className="text-sm text-muted">No players on the team roster yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {team.division === "mixed" ? (
                <>
                  <PlayerColumn
                    label="MMP"
                    tone="sky"
                    players={sortRoster(players.filter((p) => p.genderMatch === "MMP"))}
                    selected={[...members]}
                    onToggle={(id) => {
                      const p = players.find((x) => x.id === id);
                      if (p) toggleMember(p);
                    }}
                  />
                  <PlayerColumn
                    label="WMP"
                    tone="rose"
                    players={sortRoster(players.filter((p) => p.genderMatch === "WMP"))}
                    selected={[...members]}
                    onToggle={(id) => {
                      const p = players.find((x) => x.id === id);
                      if (p) toggleMember(p);
                    }}
                  />
                </>
              ) : (
                (() => {
                  const sorted = sortRoster(players);
                  const mid = Math.ceil(sorted.length / 2);
                  const tone: keyof typeof COLUMN_TONE = team.division === "open" ? "sky" : "rose";
                  const onToggle = (id: string) => {
                    const p = players.find((x) => x.id === id);
                    if (p) toggleMember(p);
                  };
                  return (
                    <>
                      <PlayerColumn
                        tone={tone}
                        players={sorted.slice(0, mid)}
                        selected={[...members]}
                        onToggle={onToggle}
                      />
                      <PlayerColumn
                        tone={tone}
                        players={sorted.slice(mid)}
                        selected={[...members]}
                        onToggle={onToggle}
                      />
                    </>
                  );
                })()
              )}
            </div>
          )}
          {busyId && <p className="text-xs text-faint">Saving…</p>}
        </div>
      )}

      {deletingTag && (
        <Modal onClose={() => setDeletingTag(null)}>
          <h2 className="font-medium">Delete tag?</h2>
          <p className="text-sm text-muted">
            Remove &ldquo;{deletingTag}&rdquo; from all {tagCounts.get(deletingTag) ?? 0} player
            {tagCounts.get(deletingTag) === 1 ? "" : "s"} who have it. This can&rsquo;t be undone.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setDeletingTag(null)}
              className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={confirmDeleteTag}
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
