"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { activeGameIds } from "@/lib/storage/gameLog";

// Shell control for jumping between concurrent live games (§13.13, §16).
// Loads on mount to avoid SSR/hydration mismatch on localStorage.
export function GameSwitcher() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    setIds(activeGameIds());
  }, []);

  if (ids.length === 0) return null;

  return (
    <nav className="flex items-center gap-2 text-sm" aria-label="Live games">
      <span className="text-faint">Live:</span>
      {ids.map((id) => (
        <Link
          key={id}
          href={`/games/${id}`}
          className="rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2.5 py-0.5 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-200 dark:bg-emerald-500/25"
        >
          ▸ {id.slice(0, 6)}
        </Link>
      ))}
    </nav>
  );
}
