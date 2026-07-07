"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Division, GameCap, OD, Player } from "@shared/game-rules";
import { createGame, rosterSnapshot } from "@/lib/storage/games";

// Create-game form, shared by individual games (pick a subset of the team roster)
// and tournament games (roster comes from check-in). Creates the game and jumps
// straight into the live caller.
export function CreateGameForm({
  teamId,
  tournamentId,
  division,
  players,
  injuredIds,
  selectable,
}: {
  teamId: string;
  tournamentId?: string;
  division: Division;
  players: Player[];
  /** Players already flagged injured (tournament check-in). */
  injuredIds?: ReadonlySet<string>;
  /** Whether the coach picks a subset of `players` for this game's roster. */
  selectable: boolean;
}) {
  const router = useRouter();
  const isMixed = division === "mixed";

  const [open, setOpen] = useState(false);
  const [opponent, setOpponent] = useState("");
  const [cap, setCap] = useState<GameCap>(13);
  const [timeouts, setTimeouts] = useState(2);
  const [startingOD, setStartingOD] = useState<OD>("O");
  const [manMajorityFirst, setManMajorityFirst] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(players.map((p) => p.id)),
  );

  const chosen = selectable
    ? players.filter((p) => selected.has(p.id))
    : players;

  const counts = useMemo(() => {
    let mmp = 0;
    let wmp = 0;
    for (const p of chosen) p.genderMatch === "MMP" ? mmp++ : wmp++;
    return { mmp, wmp, total: chosen.length };
  }, [chosen]);

  const enoughPlayers = counts.total >= 7;
  const genderWarning =
    isMixed && (counts.mmp < 4 || counts.wmp < 4)
      ? `Mixed games need 4 of a gender some points — you have ${counts.mmp} MMP / ${counts.wmp} WMP.`
      : null;

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const roster = rosterSnapshot(chosen, injuredIds ?? new Set());
    setCreating(true);
    setError(null);
    try {
      const game = await createGame({
        teamId,
        tournamentId,
        opponentName: opponent.trim() || "Opponent",
        gameCap: cap,
        timeoutsPerHalf: timeouts,
        startingOD,
        startingGenderRatio: isMixed
          ? manMajorityFirst
            ? "4MMP_3WMP"
            : "4WMP_3MMP"
          : undefined,
        roster,
      });
      router.push(`/games/${game.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-inverse px-4 py-2 text-sm font-medium text-inverse-fg hover:opacity-90"
      >
        + New game
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-line-strong p-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-muted">Opponent</span>
          <input
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="e.g. Sockeye"
            className="rounded border border-line-strong px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Game cap</span>
          <select
            value={cap}
            onChange={(e) => setCap(Number(e.target.value) as GameCap)}
            className="rounded border border-line-strong px-3 py-2"
          >
            <option value={13}>13 (half 7)</option>
            <option value={15}>15 (half 8)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Timeouts / half</span>
          <input
            type="number"
            min={0}
            max={4}
            value={timeouts}
            onChange={(e) => setTimeouts(Math.max(0, Number(e.target.value)))}
            className="rounded border border-line-strong px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Start on</span>
          <select
            value={startingOD}
            onChange={(e) => setStartingOD(e.target.value as OD)}
            className="rounded border border-line-strong px-3 py-2"
          >
            <option value="O">Offense</option>
            <option value="D">Defense</option>
          </select>
        </label>
        {isMixed && (
          <label className="flex flex-col gap-1">
            <span className="text-muted">First point majority</span>
            <select
              value={manMajorityFirst ? "MMP" : "WMP"}
              onChange={(e) => setManMajorityFirst(e.target.value === "MMP")}
              className="rounded border border-line-strong px-3 py-2"
            >
              <option value="MMP">4 MMP / 3 WMP</option>
              <option value="WMP">4 WMP / 3 MMP</option>
            </select>
          </label>
        )}
      </div>

      {selectable && (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">
            Roster ({counts.total}) — {counts.mmp} MMP · {counts.wmp} WMP
          </p>
          <div className="flex flex-wrap gap-1.5">
            {players.map((p) => {
              const on = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`rounded-full border px-2.5 py-1 text-sm ${
                    on
                      ? p.genderMatch === "MMP"
                        ? "border-sky-500 bg-sky-50 dark:bg-sky-500/10"
                        : "border-rose-500 bg-rose-50 dark:bg-rose-500/10"
                      : "border-line text-faint"
                  }`}
                >
                  {p.nickname || p.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {genderWarning && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{genderWarning}</p>
      )}
      {!enoughPlayers && (
        <p className="text-xs text-red-600 dark:text-red-400">
          Need at least 7 players on the roster ({counts.total} selected).
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!enoughPlayers || creating}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:bg-disabled"
        >
          {creating ? "Creating…" : "Create & start"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line-strong px-4 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
