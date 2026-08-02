"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Team } from "@shared/game-rules";
import {
  addTeamStrategyTag,
  deleteTeamStrategyTag,
  readTeam,
  readTeamStrategyTags,
  type StrategyTagInfo,
} from "@/lib/storage/teams";
import { useSubmit } from "@/lib/use-submit";
import { Modal } from "@/components/modal";

/**
 * The team's strategy vocabulary (§ strategy tags) — the looks they run, named
 * once here so the live caller offers them from the first point instead of
 * making a coach type them mid-game.
 *
 * The list isn't the only source of these names: points store tag strings
 * directly, so anything typed during a game shows up here too, marked with how
 * many points carry it. That's also why an in-use strategy can't be deleted —
 * removing the row wouldn't un-tag those points, and it would reappear here
 * immediately.
 */
export function StrategyEditor({ teamId }: { teamId: string }) {
  const [team, setTeam] = useState<Team | null | undefined>(undefined);
  const [tags, setTags] = useState<StrategyTagInfo[] | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<StrategyTagInfo | null>(null);
  const { submitting, error, setError, submit } = useSubmit();

  useEffect(() => {
    readTeam(teamId).then(setTeam);
    readTeamStrategyTags(teamId).then(setTags);
  }, [teamId]);

  const duplicate =
    !!tags &&
    tags.some((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase());

  const add = () =>
    submit(async () => {
      if (!name.trim() || duplicate) return;
      setTags(await addTeamStrategyTag(teamId, name.trim()));
      setName("");
    });

  const confirmDelete = () =>
    submit(async () => {
      if (!deleting) return;
      setTags(await deleteTeamStrategyTag(teamId, deleting.name));
      setDeleting(null);
    });

  if (team === undefined) return <p className="text-muted">Loading…</p>;
  if (team === null) {
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-muted">Team not found.</p>
        <Link href="/teams" className="text-sm text-emerald-700 underline dark:text-emerald-400">
          Back to teams
        </Link>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/teams/${teamId}`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
        >
          <span aria-hidden>←</span> {team.name}
        </Link>
        <h1 className="text-xl font-semibold">Strategy</h1>
        <p className="text-sm text-muted">
          The looks this team runs. Tag a point with one during a game and the
          stats break down efficiency by strategy — how you did in zone on
          defence versus person, and so on.
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-dashed border-line-strong p-4">
        <p className="text-sm font-medium">New strategy</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="e.g. Zone, Person, Cup"
            maxLength={40}
            className="min-w-[10rem] flex-1 rounded border border-line-strong px-3 py-2 text-sm"
          />
          <button
            onClick={add}
            disabled={!name.trim() || duplicate || submitting}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:bg-disabled"
          >
            {submitting ? "Adding…" : "Add"}
          </button>
        </div>
        {duplicate && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            That strategy already exists.
          </p>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {tags === null ? (
        <p className="text-muted">Loading…</p>
      ) : tags.length === 0 ? (
        <p className="text-sm text-muted">
          No strategies yet — add the ones this team runs above.
        </p>
      ) : (
        <ul className="space-y-2">
          {tags.map((tag) => (
            <li
              key={tag.name}
              className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
            >
              <span className="flex items-center gap-2">
                <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-sm font-medium text-violet-800 dark:bg-violet-500/20 dark:text-violet-300">
                  {tag.name}
                </span>
                <span className="text-xs text-faint">
                  {tag.pointsUsing === 0
                    ? "not used yet"
                    : `on ${tag.pointsUsing} point${tag.pointsUsing === 1 ? "" : "s"}`}
                </span>
              </span>
              {tag.pointsUsing === 0 ? (
                <button
                  onClick={() => setDeleting(tag)}
                  className="rounded-md border border-line-strong px-2.5 py-1 text-sm text-muted hover:text-fg"
                >
                  Delete
                </button>
              ) : (
                <span
                  className="text-xs text-faint"
                  title="Re-tag those points before this can be removed"
                >
                  In use
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <Modal onClose={() => setDeleting(null)}>
          <h2 className="font-medium">Delete strategy?</h2>
          <p className="text-sm text-muted">
            Remove &ldquo;{deleting.name}&rdquo; from this team&rsquo;s
            strategies. No points are using it, so nothing else changes.
          </p>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setDeleting(null)}
              className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={submitting}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:bg-disabled"
            >
              {submitting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
