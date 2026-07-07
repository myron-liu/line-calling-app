"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Division, Team } from "@shared/game-rules";
import { createTeam, readTeams } from "@/lib/storage/teams";

export function TeamsList() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [name, setName] = useState("");
  const [division, setDivision] = useState<Division>("mixed");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readTeams()
      .then(setTeams)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const add = async () => {
    if (!name.trim()) return;
    try {
      await createTeam(name.trim(), division);
      setTeams(await readTeams());
      setName("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (teams === null) return <p className="text-muted">Loading…</p>;

  return (
    <section className="space-y-6">
      <h1 className="text-xl font-semibold">Your teams</h1>

      {teams.length === 0 ? (
        <p className="text-muted">No teams yet — create your first below.</p>
      ) : (
        <ul className="space-y-2">
          {teams.map((t) => (
            <li key={t.id}>
              <Link
                href={`/teams/${t.id}`}
                className="flex items-center justify-between rounded-lg border border-line px-4 py-3 hover:bg-surface-2"
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-xs uppercase tracking-wide text-faint">
                  {t.division}
                </span>
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
