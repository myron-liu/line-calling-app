"use client";

import { useState } from "react";
import Link from "next/link";
import type { Division, Team } from "@shared/game-rules";
import { createTeam, deleteTeam, readTeams } from "@/lib/storage/teams";
import { updateMyProfile } from "@/lib/storage/me";
import { sameById, useCachedFetch } from "@/lib/cache";
import { keys } from "@/lib/storage/keys";
import { useAuth } from "@/lib/auth/auth-context";
import { Modal } from "@/components/modal";
import { useSubmit } from "@/lib/use-submit";

export function TeamsList() {
  const { session, updateProfile } = useAuth();
  const firstName = session?.user.user_metadata?.first_name as string | undefined;
  const lastName = session?.user.user_metadata?.last_name as string | undefined;
  const { data: teams, error: fetchError, refresh } = useCachedFetch<Team[]>(
    keys.teams,
    readTeams,
    sameById,
    [],
  );
  const [name, setName] = useState("");
  const [division, setDivision] = useState<Division>("mixed");
  const [editingName, setEditingName] = useState(false);
  const [deleting, setDeleting] = useState<Team | null>(null);
  const { submitting, error, setError, submit } = useSubmit();

  // Flagged before the request goes out, so the coach sees why the button is
  // dead rather than a 409 after the round trip. The server enforces the same
  // rule (see DuplicateError) — this is just the faster half.
  const duplicate = teams?.some(
    (t) => t.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  const add = () =>
    submit(async () => {
      if (!name.trim() || duplicate) return;
      await createTeam(name.trim(), division);
      await refresh();
      setName("");
    });

  const confirmDelete = () => {
    if (!deleting) return;
    deleteTeam(deleting.id)
      .then(() => {
        setDeleting(null);
        return refresh();
      })
      .catch((err) => {
        setDeleting(null);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  if (teams === null) {
    return (
      <p className={fetchError ? "text-red-600 dark:text-red-400" : "text-muted"}>
        {fetchError ?? "Loading…"}
      </p>
    );
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm text-muted">
          {firstName ? `Hello, ${firstName}!` : "Add your name"}
          <button
            onClick={() => setEditingName(true)}
            aria-label="Edit your name"
            title="Edit your name"
            className="text-faint hover:text-fg"
          >
            <EditIcon />
          </button>
        </p>
        <h1 className="text-xl font-semibold">Your teams</h1>
        <p className="text-sm text-muted">
          Line Calling helps ultimate frisbee coaches build gender-ratio-compliant
          lines from the sideline — track O/D, score, timeouts, and injuries in
          real time, and manage rosters, tournaments, and reusable lines from any
          device.
        </p>
      </div>

      {teams.length === 0 ? (
        <p className="text-muted">No teams yet — create your first below.</p>
      ) : (
        <ul className="space-y-2">
          {teams.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between rounded-lg border border-line px-4 py-3"
            >
              <div>
                <span className="font-medium">{t.name}</span>
                <span className="ml-2 text-xs uppercase tracking-wide text-faint">
                  {t.division}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/teams/${t.id}`}
                  className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-surface-2 dark:text-emerald-400"
                >
                  View team →
                </Link>
                <button
                  onClick={() => setDeleting(t)}
                  aria-label={`Delete ${t.name}`}
                  title="Delete team"
                  className="rounded-md border border-line-strong p-1.5 text-faint hover:text-red-600 dark:hover:text-red-400"
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-lg border border-dashed border-line-strong p-4">
        <p className="text-sm font-medium">New team</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team name"
            className="min-w-[8rem] flex-1 rounded border border-line-strong px-3 py-2 text-sm"
          />
          <select
            value={division}
            onChange={(e) => setDivision(e.target.value as Division)}
            className="rounded border border-line-strong px-3 py-2 text-sm"
          >
            <option value="mixed">Mixed</option>
            <option value="open">Open</option>
            <option value="women">Women</option>
          </select>
          <button
            onClick={add}
            disabled={!name.trim() || !!duplicate || submitting}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:bg-disabled"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
        {duplicate && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            You already have a team with this name.
          </p>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {editingName && (
        <EditNameModal
          firstName={firstName ?? ""}
          lastName={lastName ?? ""}
          onClose={() => setEditingName(false)}
          onSave={async (first, last) => {
            await Promise.all([
              updateProfile(first, last),
              updateMyProfile(first, last),
            ]);
            setEditingName(false);
          }}
        />
      )}

      {deleting && (
        <Modal onClose={() => setDeleting(null)}>
          <h2 className="font-medium">Delete {deleting.name}?</h2>
          <p className="text-sm text-muted">
            This removes {deleting.name} from your teams list. If you need it
            back later, just ask — nothing is actually erased.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setDeleting(null)}
              className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
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

function EditNameModal({
  firstName,
  lastName,
  onClose,
  onSave,
}: {
  firstName: string;
  lastName: string;
  onClose: () => void;
  onSave: (firstName: string, lastName: string) => Promise<void>;
}) {
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!first.trim() || !last.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(first.trim(), last.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="font-medium">Edit your name</h2>
      <div className="space-y-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted">First name</span>
          <input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            className="h-9 rounded border border-line-strong px-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Last name</span>
          <input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            className="h-9 rounded border border-line-strong px-2"
          />
        </label>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-muted hover:text-fg">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || !first.trim() || !last.trim()}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:bg-disabled"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

// Small pencil icon — matches the one in team-detail.tsx (kept local, no
// shared icon library in this app).
function EditIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <path
        d="M13.5 3.5l3 3L7 16l-4 1 1-4 9.5-9.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Small trash icon — no icon library dependency, just an inline SVG.
function TrashIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <path
        d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m2 0v9a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 6 15V6h8Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
