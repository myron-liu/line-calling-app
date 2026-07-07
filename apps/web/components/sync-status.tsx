"use client";

import { useEffect, useState } from "react";
import { pendingCount } from "@/lib/storage/outbox";

// Top-bar sync indicator (§16 shell). Reads the outbox on mount and on focus.
// TODO(M3): expand into a dropdown panel with retry + conflict details.
export function SyncStatus() {
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const refresh = () => {
      setPending(pendingCount());
      setOnline(navigator.onLine);
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span
        className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`}
        aria-hidden
      />
      {online ? "Online" : "Offline"}
      {pending > 0 && <span className="text-faint">· {pending} queued</span>}
    </span>
  );
}
