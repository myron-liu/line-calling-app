// Read-through cache for "setup" pages (/teams, /teams/:id). These are
// online-only by design (§13.12) — no offline write buffering — but that
// doesn't mean every visit needs a loading flash: render whatever was last
// fetched instantly, then check the server in the background and only
// re-render if the result actually differs from what's cached.
//
// There's no push channel for these yet (unlike the live game's SSE — see
// apps/server/src/sse.ts), so "background check" currently means "fetch on
// every mount," not "wait for a server-sent event telling us to refresh."

import { useCallback, useEffect, useRef, useState } from "react";
import { read, write } from "./storage/store";

export interface CachedFetchResult<T> {
  /** Last-known-good value — from cache instantly, then whatever the most
   *  recent fetch resolved to. Null only when there's truly nothing yet. */
  data: T | null;
  /** Set only when a fetch fails and there's no cached value to fall back on
   *  — a background refresh failure (e.g. offline) silently keeps showing
   *  the cached data instead of surfacing an error. */
  error: string | null;
  /** Re-run the fetch-and-diff on demand, e.g. right after a local mutation
   *  so the cache doesn't wait for the next mount to catch up. */
  refresh: () => Promise<void>;
}

export function useCachedFetch<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  isSame: (a: T, b: T) => boolean,
  deps: unknown[],
): CachedFetchResult<T> {
  const [data, setData] = useState<T | null>(() => read<T | null>(cacheKey, null));
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const refresh = useCallback(async () => {
    try {
      const fresh = await fetcher();
      setError(null);
      setData((cur) => {
        if (cur !== null && isSame(cur, fresh)) return cur; // no visible change
        write(cacheKey, fresh);
        return fresh;
      });
    } catch (err) {
      if (dataRef.current === null) {
        setError(err instanceof Error ? err.message : String(err));
      }
      // Otherwise: background refresh failed (e.g. offline) — keep showing
      // the cached value rather than replacing it with an error.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, refresh };
}

/** Order-independent list equality by id — the server doesn't guarantee row
 *  order without an explicit ORDER BY, so a plain positional/JSON compare
 *  would flag an identical-but-reordered list as "changed". */
export function sameById<T extends { id: string }>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const bMap = new Map(b.map((x) => [x.id, x]));
  return a.every((x) => {
    const y = bMap.get(x.id);
    return y !== undefined && JSON.stringify(x) === JSON.stringify(y);
  });
}

export const sameJson = <T,>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b);
