"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Team } from "@shared/game-rules";
import { activeGameIds, readGameConfig } from "@/lib/storage/gameLog";
import { readTeam } from "@/lib/storage/teams";

interface LiveGameEntry {
  id: string;
  teamName: string;
  opponentName: string;
}

// Shell control for jumping between concurrent live games (§13.13, §16).
// Loads on mount to avoid SSR/hydration mismatch on localStorage. Reads each
// game's live status from the server (not just the local registration list)
// so a game ended from another device/session drops out here too.
export function GameSwitcher() {
  const [entries, setEntries] = useState<LiveGameEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const teamCache = new Map<string, Promise<Team | null>>();
      const results = await Promise.all(
        activeGameIds().map(async (id): Promise<LiveGameEntry | null> => {
          const game = readGameConfig(id);
          if (!game || game.status === "completed") return null;
          if (!teamCache.has(game.teamId)) {
            teamCache.set(game.teamId, readTeam(game.teamId));
          }
          const team = await teamCache.get(game.teamId)!;
          return { id, teamName: team?.name ?? "Team", opponentName: game.opponentName };
        }),
      );
      if (!cancelled) {
        setEntries(results.filter((e): e is LiveGameEntry => e !== null));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <nav className="flex items-center gap-2 text-sm" aria-label="Live games">
      <span className="text-faint">Live:</span>
      {entries.map((e) => (
        <Link
          key={e.id}
          href={`/games/${e.id}`}
          className="rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2.5 py-0.5 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-200 dark:bg-emerald-500/25"
        >
          ▸ {e.teamName} vs {e.opponentName}
        </Link>
      ))}
    </nav>
  );
}
