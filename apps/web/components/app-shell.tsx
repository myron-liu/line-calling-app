import Link from "next/link";
import type { ReactNode } from "react";
import { GameSwitcher } from "./game-switcher";
import { SyncStatus } from "./sync-status";
import { ThemeToggle } from "./theme-toggle";

// Persistent shell (§16): brand, live-game switcher, and the sync/offline
// indicator. v0 is public — no auth, no settings.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
        <Link href="/teams" className="font-semibold tracking-tight">
          Line Calling
        </Link>
        <div className="flex items-center gap-4">
          <GameSwitcher />
          <SyncStatus />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
