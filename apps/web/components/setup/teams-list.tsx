"use client";

import { useState } from "react";
import Link from "next/link";
import type { Division, Team } from "@shared/game-rules";
import { createTeam, readTeams } from "@/lib/storage/teams";
import { sameById, useCachedFetch } from "@/lib/cache";
import { keys } from "@/lib/storage/keys";
import { useAuth } from "@/lib/auth/auth-context";

export function TeamsList() {
  const { session } = useAuth();
  const firstName = session?.user.user_metadata?.first_name as string | undefined;
  const { data: teams, error: fetchError, refresh } = useCachedFetch<Team[]>(
    keys.teams,
    readTeams,
    sameById,
    [],
  );
  const [name, setName] = useState("");
  const [division, setDivision] = useState<Division>("mixed");
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim()) return;
    try {
      await createTeam(name.trim(), division);
      await refresh();
      setName("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
        {firstName && <p className="text-sm text-muted">Hello, {firstName}!</p>}
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
              <Link
                href={`/teams/${t.id}`}
                className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-surface-2 dark:text-emerald-400"
              >
                View team →
              </Link>
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
            disabled={!name.trim()}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:bg-disabled"
          >
            Create
          </button>
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </section>
  );
}
