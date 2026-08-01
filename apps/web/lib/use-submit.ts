"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";

/**
 * Runs a create/save action at most once at a time.
 *
 * Coaches use this app one-handed on a sideline, and a double-tapped "Create"
 * used to produce two rows. Guarding on a `useState` flag alone isn't enough:
 * two taps in the same frame both read the pre-render `false`, so the guard is
 * a ref (updated synchronously) and the state exists only to re-render the
 * disabled button.
 *
 * The server rejects true duplicates on its own (see DuplicateError in
 * apps/server/src/db/queries.ts) — this is the fast local half of that pair,
 * and surfaces the server's message when the request loses the race anyway.
 */
export function useSubmit(): {
  /** True while a submission is in flight — bind to the button's `disabled`. */
  submitting: boolean;
  /** The last failure, ready to render. Cleared at the start of each attempt. */
  error: string | null;
  setError: (message: string | null) => void;
  /** Ignores the call entirely if one is already running. */
  submit: (action: () => Promise<void>) => Promise<void>;
} {
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : String(err),
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, []);

  return { submitting, error, setError, submit };
}
