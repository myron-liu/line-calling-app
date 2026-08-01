"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Player, Tournament } from "@shared/game-rules";
import { readPlayers } from "@/lib/storage/teams";
import {
  findTournament,
  readTournamentPlayerTags,
  syncTournamentPlayerTags,
} from "@/lib/storage/tournaments";
import { sortRoster } from "@/lib/player-display";
import { Modal } from "@/components/modal";
import { COLUMN_TONE, PlayerColumn } from "./lines-editor";

// How long to wait after the coach's last tap before flushing to the server —
// long enough that a quick run through several players collapses into one
// request, short enough that it still reads as "autosave", not "save button".
const AUTOSAVE_DELAY_MS = 900;

// Quick player tagging, mirroring the lines/pods editor's shape: pick or
// create a tag, then toggle roster membership straight from a roster grid —
// no per-player modal round-trip. Tags are tournament-scoped (§
// TournamentPlayerTags) — a team often reuses the same roster differently
// across tournaments — so this reads/writes that tournament's tags, not the
// player record itself.
export function PlayerTagsEditor({ tournamentId }: { tournamentId: string }) {
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [players, setPlayers] = useState<Player[]>([]);
  // The locally-authoritative tag membership: seeded from the server, then
  // mutated immediately as the coach toggles (for instant feedback), with
  // changes flushed to the server after AUTOSAVE_DELAY_MS of inactivity
  // rather than one request per tap (see scheduleSync).
  const [tagsByPlayerId, setTagsByPlayerId] = useState<Record<string, string[]>>({});
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [deletingTag, setDeletingTag] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingRef = useRef<Map<string, string[]>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    findTournament(tournamentId).then((t) => {
      setTournament(t);
      if (!t) return;
      Promise.all([readPlayers(t.teamId), readTournamentPlayerTags(tournamentId)]).then(
        ([ps, tags]) => {
          setPlayers(ps);
          const map: Record<string, string[]> = {};
          for (const entry of tags) map[entry.playerId] = entry.tags;
          setTagsByPlayerId(map);
        },
      );
    });
  }, [tournamentId]);

  const flush = () => {
    if (pendingRef.current.size === 0) return;
    const changes = [...pendingRef.current.entries()].map(([playerId, tags]) => ({
      playerId,
      tags,
    }));
    pendingRef.current = new Map();
    setSaving(true);
    syncTournamentPlayerTags(tournamentId, changes)
      .then(() => setError(null))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  // Flush on unmount too, so a tap right before navigating away isn't lost
  // to the debounce timer never getting to fire.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleSync = (playerId: string, tags: string[]) => {
    pendingRef.current.set(playerId, tags);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
  };

  // Every tag currently in use, with how many players carry it — the tag
  // itself has no separate record, it just exists as long as someone has it.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tags of Object.values(tagsByPlayerId)) {
      for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [tagsByPlayerId]);
  const allTags = useMemo(
    () => [...tagCounts.keys()].sort((a, b) => a.localeCompare(b)),
    [tagCounts],
  );

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

  const selectTag = (tag: string) => {
    setActiveTag(tag);
    setError(null);
  };

  const createTag = () => {
    const t = newTagInput.trim();
    if (!t) return;
    // Not persisted until the first player is toggled onto it — matches
    // "a tag exists as long as someone has it".
    setActiveTag(t);
    setNewTagInput("");
    setError(null);
  };

  const toggleMember = (player: Player) => {
    if (!activeTag) return;
    const current = tagsByPlayerId[player.id] ?? [];
    const has = current.includes(activeTag);
    const next = has ? current.filter((t) => t !== activeTag) : [...current, activeTag];
    setTagsByPlayerId((cur) => ({ ...cur, [player.id]: next }));
    scheduleSync(player.id, next);
  };

  const confirmDeleteTag = () => {
    if (!deletingTag) return;
    const tag = deletingTag;
    setDeletingTag(null);
    const updates = players
      .filter((p) => (tagsByPlayerId[p.id] ?? []).includes(tag))
      .map((p): [string, string[]] => [p.id, (tagsByPlayerId[p.id] ?? []).filter((t) => t !== tag)]);
    setTagsByPlayerId((cur) => {
      const next = { ...cur };
      for (const [id, tags] of updates) next[id] = tags;
      return next;
    });
    for (const [id, tags] of updates) scheduleSync(id, tags);
    if (activeTag === tag) setActiveTag(null);
  };

  const members = activeTag
    ? new Set(
        players.filter((p) => (tagsByPlayerId[p.id] ?? []).includes(activeTag)).map((p) => p.id),
      )
    : new Set<string>();

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/tournaments/${tournamentId}`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
        >
          <span aria-hidden>←</span> {tournament.name}
        </Link>
        <h1 className="text-xl font-semibold">Player tags</h1>
        <p className="text-sm text-muted">
          Tag players with custom labels (e.g. &ldquo;Zone D specialist&rdquo;) for this
          tournament — filterable in the live caller&rsquo;s line builder. Changes save
          automatically a moment after your last tap.
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-line-strong p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Tags</p>
          {saving && <span className="text-xs text-faint">Saving…</span>}
        </div>
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
              {tournament.division === "mixed" ? (
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
                  const tone: keyof typeof COLUMN_TONE =
                    tournament.division === "open" ? "sky" : "rose";
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
        </div>
      )}

      {deletingTag && (
        <Modal onClose={() => setDeletingTag(null)}>
          <h2 className="font-medium">Delete tag?</h2>
          <p className="text-sm text-muted">
            Remove &ldquo;{deletingTag}&rdquo; from all {tagCounts.get(deletingTag) ?? 0} player
            {tagCounts.get(deletingTag) === 1 ? "" : "s"} who have it in this tournament. This
            can&rsquo;t be undone.
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
