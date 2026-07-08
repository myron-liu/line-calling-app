"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  callHalftime,
  callTimeout,
  confirmLine,
  deriveHalftimeReached,
  deriveLiveGameState,
  editPointLineup,
  endGame,
  injurySub,
  recordResult,
  redoAction as replayRedo,
  undoLastPoint,
  type Game,
  type GameLogState,
  type GameMeta,
  type GenderRatio,
  type LiveGameState,
  type OD,
  type Point,
  type PointResult,
  type RedoAction,
  type SavedLine,
} from "@shared/game-rules";
import { api, apiUrl } from "@/lib/api/client";
import { newId } from "@/lib/id";
import {
  readGameConfig,
  readLastSyncedAt,
  readLog,
  readMeta,
  readRosterSnapshot,
  registerGame,
  setRosterInjured,
  unregisterGame,
  writeGameConfig,
  writeLastSyncedAt,
  writeLog,
  writeMeta,
  writeRosterSnapshot,
  type GameFull,
  type RosterSnapshotEntry,
} from "@/lib/storage/gameLog";
import {
  dropPending,
  enqueue,
  flush,
  pendingCountFor,
  type FlushResult,
  type OutboxEventType,
} from "@/lib/storage/outbox";
import {
  createSavedLine,
  incrementLineUsage,
  readSavedLines,
} from "@/lib/storage/savedLines";
import {
  resolveFlip as resolveFlipApi,
  undoFlip as undoFlipApi,
} from "@/lib/storage/games";

/** Saved lines are team-scoped (§4.3). */
const savedLinesScope = (game: Game): string => game.teamId;

/** What a RedoAction's underlying transition is called in the UI, so the
 *  undo/redo buttons can say precisely what they'll do (e.g. "Undo line" on
 *  the point_in_progress/"we scored?" view vs "Undo point" on awaiting_line)
 *  instead of a generic "Undo". */
const REDO_ACTION_WORD: Record<RedoAction["type"], string> = {
  confirmLine: "line",
  recordResult: "point",
  callHalftime: "halftime",
  endGame: "end",
};

/** Sync status for the "Last synced" indicator + manual resync button (§ live
 *  caller shell). There's no lingering "conflict" state: whenever the server
 *  turns out to be further along than our local version, we don't try to
 *  save a transition computed off stale data — we just refresh (adopt the
 *  server's state wholesale) and briefly show "syncing" while that happens. */
export type SyncStatusKind = "idle" | "syncing" | "synced" | "offline";

export interface SyncState {
  status: SyncStatusKind;
  lastSyncedAt: string | null;
}

export type LiveGameResult =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "ready"; live: LiveGame };

export interface LiveGame {
  game: Game;
  roster: RosterSnapshotEntry[];
  state: LiveGameState;
  /** The raw point log, for line history (§ recap). */
  points: Point[];
  savedLines: SavedLine[];
  /** Line pre-selected after an undo, so the coach can re-call it. */
  carryOver: string[] | null;
  /** Whether there's anything for the undo/redo buttons to do — the UI
   *  should hide rather than disable them when these are false. */
  canUndo: boolean;
  canRedo: boolean;
  /** What the undo/redo buttons would actually do, e.g. "Undo line" vs
   *  "Undo point" — null exactly when canUndo/canRedo is false. */
  undoLabel: string | null;
  redoLabel: string | null;
  sync: SyncState;
  actions: {
    confirmLine: (lineup: string[]) => void;
    recordResult: (scorer: PointResult) => void;
    callHalftime: () => void;
    callTimeout: (team: PointResult) => void;
    injurySub: (injuredPlayerId: string, replacementPlayerId: string) => void;
    editPointLineup: (pointId: string, lineup: string[]) => void;
    endGame: () => void;
    undo: () => void;
    /** Reapplies exactly what the last undo reverted; available until any
     *  other action invalidates it (see commit()). */
    redo: () => void;
    saveLine: (name: string, playerIds: string[]) => void;
    recordLineUsage: (id: string) => void;
    setInjured: (playerId: string, injured: boolean) => void;
    /** Manually push pending local changes, or — if rejected as stale, or if
     *  there's nothing local to push — pull the server's current state and
     *  adopt it (discarding any unsynced local changes; see queries.ts's
     *  syncGame for why a stale push is rejected instead of overwriting). */
    resyncNow: () => void;
    /** Resolves the post-creation coin flip, moving the game from
     *  "scheduled" to "in_progress" (see flip-result-form). */
    resolveFlip: (patch: {
      fieldSide: "left" | "right";
      teamColor: "light" | "dark";
      startingOD: OD;
      startingGenderRatio?: GenderRatio;
    }) => Promise<void>;
    /** Reverts a resolved flip back to "scheduled" — only valid before the
     *  game's first point has been recorded (see queries.ts's undoFlip). */
    undoFlip: () => Promise<void>;
  };
  error: string | null;
}

export function useLiveGame(gameId: string): LiveGameResult {
  const [game, setGame] = useState<Game | null>(null);
  const [roster, setRoster] = useState<RosterSnapshotEntry[]>([]);
  const [log, setLog] = useState<GameLogState | null>(null);
  const [savedLines, setSavedLines] = useState<SavedLine[]>([]);
  const [carryOver, setCarryOver] = useState<string[] | null>(null);
  const [pendingRedo, setPendingRedo] = useState<RedoAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>({
    status: "idle",
    lastSyncedAt: null,
  });

  const defaultMeta = (g: Game): GameMeta => ({
    halftimeReached: false,
    ourTimeoutsRemaining: g.timeoutsPerHalf,
    theirTimeoutsRemaining: g.timeoutsPerHalf,
    endedManually: false,
  });

  // The version runSync() must send with its *next* attempt. Updated
  // synchronously at every point `game`'s version conceptually changes
  // (here, and in runSync()'s own success branch) — never via a `useEffect`
  // keyed on `game`, since an effect only runs after React commits a render,
  // and two chained sync attempts can be microtasks apart, well inside that
  // gap. Relying on an effect-lagged ref here would read the *previous*
  // version for a rapid second attempt, causing the server to genuinely
  // reject it as stale even though nothing external caused it - discarding
  // that second attempt's local change entirely once adoptServerState below
  // overwrites it with the server's (not-yet-updated) copy.
  const versionRef = useRef<number | null>(null);

  /** Overwrite the local cache with the server's authoritative state — used to
   *  resolve a sync conflict, or to catch up when another device has moved the
   *  game ahead of us. Drops any pending outbox events for this game, since
   *  they were relative to the state we're now discarding. */
  const adoptServerState = useCallback(
    (full: GameFull, hadPending: boolean) => {
      writeGameConfig(full.game);
      writeMeta(gameId, full.meta);
      writeLog(gameId, full.points);
      writeRosterSnapshot(gameId, full.roster);
      dropPending(gameId);
      const now = new Date().toISOString();
      writeLastSyncedAt(gameId, now);
      versionRef.current = full.game.version;
      setGame(full.game);
      setRoster(full.roster);
      setLog({ points: full.points, meta: full.meta });
      setSyncState({ status: "synced", lastSyncedAt: now });
      setError(
        hadPending
          ? "This game was updated from another device since your last sync — local changes were replaced with the latest data from the server."
          : null,
      );
    },
    [gameId],
  );

  // Load from storage on mount, falling back to the server if this device has
  // no local cache for this game yet — e.g. the game was created on a
  // different device/browser, or local storage was cleared. The live game
  // still never *requires* the network once loaded; this is just a one-time
  // adoption path for a cold local cache.
  useEffect(() => {
    let cancelled = false;
    const g = readGameConfig(gameId);
    if (g) {
      versionRef.current = g.version;
      setGame(g);
      setRoster(readRosterSnapshot(gameId));
      readSavedLines(savedLinesScope(g)).then(setSavedLines);
      setLog({
        points: readLog(gameId),
        meta: readMeta(gameId) ?? defaultMeta(g),
      });
      setSyncState({ status: "idle", lastSyncedAt: readLastSyncedAt(gameId) });
      return;
    }
    api
      .get<GameFull>(`/games/${gameId}/full`)
      .then((full) => {
        if (cancelled) return;
        adoptServerState(full, false);
        registerGame(gameId);
        readSavedLines(savedLinesScope(full.game)).then(setSavedLines);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, adoptServerState]);

  // Kept in sync so the SSE handler below (a plain callback, not a state
  // updater) can read the latest game version without re-subscribing on
  // every commit.
  const gameRef = useRef<Game | null>(null);
  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  // Every sync attempt is chained through this ref so overlapping ones (e.g.
  // two actions committed in quick succession — well within a single
  // PUT /sync round-trip of each other, which the live caller does nothing
  // to prevent, since setLog()/setError() happen synchronously and the next
  // action can fire immediately) can never race each other with the same
  // stale version. Without this, a fast second commit would read the same
  // version the first one just used, get a perfectly legitimate 409 back
  // once the first one's already landed, and this device would see its
  // *own* prior action mislabeled as "updated from another device" — not a
  // real cross-device conflict at all. Chaining onto this ref means each
  // attempt only ever runs once every prior one has fully settled (success
  // or not), so it always reads versionRef.current *after* that prior
  // attempt's own update to it.
  const syncChainRef = useRef<Promise<void>>(Promise.resolve());

  const runSync = useCallback((): Promise<FlushResult> => {
    const attempt: Promise<FlushResult> = syncChainRef.current.then(async () => {
      const current = gameRef.current;
      const version = versionRef.current;
      if (!current || version === null) return { status: "nothing-pending" } as const;
      const result = await flush(gameId, {
        version,
        meta: readMeta(gameId) ?? defaultMeta(current),
        points: readLog(gameId),
        roster: readRosterSnapshot(gameId),
      });
      if (result.status === "synced") {
        const updated = readGameConfig(gameId);
        if (updated) {
          versionRef.current = updated.version;
          setGame(updated);
        }
        setSyncState({ status: "synced", lastSyncedAt: readLastSyncedAt(gameId) });
      } else if (result.status === "conflict") {
        // A real conflict: this attempt's version, read *after* every
        // earlier queued attempt already landed, was still rejected — the
        // server genuinely moved on without us.
        adoptServerState(result.full, true);
      } else if (result.status === "offline") {
        setSyncState((s) => ({ ...s, status: "offline" }));
      }
      return result;
    });
    // Keep the chain alive even if this attempt throws, so one failure
    // doesn't permanently wedge every later commit's sync.
    syncChainRef.current = attempt.then(
      () => undefined,
      () => undefined,
    );
    return attempt;
  }, [gameId, adoptServerState]);

  // Real-time conflict notifications (see apps/server/src/sse.ts): while this
  // game is open, learn about another device's write immediately instead of
  // only on our own next (rejected) sync attempt. Either way — a clean write
  // or one that bounced someone else's stale attempt — the same rule
  // applies: if the server is further along than our local version, don't
  // try to save a transition computed off data that's already stale; just
  // refresh (adopt the server's state wholesale) instead.
  //
  // The server broadcasts a game's own writer back to itself too (it has no
  // way to know which open connection is "the one that just wrote"), and it
  // does so *before* that writer's own PUT /games/:id/sync response comes
  // back — so this handler can see the version bump before runSync()'s own
  // chained attempt has resolved. If we have a pending outbox event for this
  // game, that in-flight write is almost certainly what this broadcast is
  // echoing back, not a foreign update; skip it and let that attempt's own
  // result reconcile things (a clean success, or, if it really was
  // overtaken, a 409 that correctly reports the replacement). Without this
  // guard, a coach making changes alone on one device would routinely see
  // "updated from another device" for their own actions.
  useEffect(() => {
    const source = new EventSource(apiUrl(`/games/${gameId}/events`));
    source.onmessage = (ev) => {
      if (!ev.data) return;
      let data: { type: "updated" | "conflict"; version: number };
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      const current = gameRef.current;
      if (!current || data.version <= current.version) return;
      if (pendingCountFor(gameId) > 0) return;
      setSyncState((s) => ({ ...s, status: "syncing" }));
      api
        .get<GameFull>(`/games/${gameId}/full`)
        .then((full) => adoptServerState(full, false))
        .catch(() => {});
    };
    return () => source.close();
  }, [gameId, adoptServerState]);

  // Saved-lines updates (see apps/server/src/sse.ts's savedLinesChannel):
  // deliberately independent of the game-sync machinery above. Pods are a
  // team-scoped, reusable resource — creating/editing/using/deleting one on
  // another device should just refresh this device's saved-lines list, never
  // touch `game`/`log`/syncState or run through adoptServerState. This is
  // also what lets *this* device's own saveLine/recordLineUsage calls (which
  // don't go through commit()/the outbox at all) stay fully decoupled from
  // the game's own version/conflict handling.
  const teamId = game?.teamId;
  useEffect(() => {
    if (!teamId) return;
    const source = new EventSource(apiUrl(`/teams/${teamId}/saved-lines/events`));
    source.onmessage = (ev) => {
      if (!ev.data) return;
      readSavedLines(teamId).then(setSavedLines);
    };
    return () => source.close();
  }, [teamId]);

  // Best-effort background sync, once on load: pick up roster changes made
  // server-side (e.g. a tournament check-in edit) since this game was created,
  // and flush any outbox backlog left over from a previous offline session.
  // Both fail silently — the live game must never depend on being online.
  useEffect(() => {
    if (!game) return;
    api
      .get<{ roster: RosterSnapshotEntry[] }>(`/games/${gameId}/full`)
      .then(({ roster: serverRoster }) => {
        const localById = new Map(
          readRosterSnapshot(gameId).map((e) => [e.playerId, e]),
        );
        const serverIds = new Set(serverRoster.map((e) => e.playerId));
        // This device is authoritative for in-game injury toggles until they've
        // been flushed, so never let a background refresh revert one.
        const merged: RosterSnapshotEntry[] = serverRoster.map((s) => {
          const local = localById.get(s.playerId);
          return local ? { ...s, injured: local.injured } : s;
        });
        for (const local of localById.values()) {
          if (!serverIds.has(local.playerId)) merged.push({ ...local, active: false });
        }
        writeRosterSnapshot(gameId, merged);
        setRoster(merged);
      })
      .catch(() => {});

    // Flush any outbox backlog left over from a previous offline session.
    // Routed through the same serialized runSync() as every other sync
    // attempt (see its definition above) rather than a raw flush() call, so
    // this can never race a commit's own in-flight sync with a stale
    // version — it just queues behind it. runSync() itself no-ops if
    // there's nothing pending, and already handles a conflict by refreshing
    // rather than leaving the coach staring at a blocked state.
    runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, gameId]);

  const state = useMemo(
    () => (game && log ? deriveLiveGameState(game, log.points, log.meta) : null),
    [game, log],
  );

  /** Persist a new log state, mirror to the outbox, and best-effort sync via
   *  the serialized runSync() (see its definition above) — never a raw
   *  flush() here, so a burst of fast commits can't race each other with a
   *  stale version. */
  const commit = useCallback(
    (next: GameLogState, type: OutboxEventType, payload: unknown) => {
      // Any real log mutation invalidates a pending redo — it was only ever
      // valid for replaying exactly the undo that produced it. undo() and
      // redo() themselves set the redo state explicitly right after this.
      setPendingRedo(null);
      writeLog(gameId, next.points);
      writeMeta(gameId, next.meta);
      enqueue(gameId, type, payload);
      setLog(next);
      setError(null);
      runSync();
    },
    [gameId, runSync],
  );

  /** Wrap a reducer call so thrown validation errors surface, not crash. */
  const run = useCallback(
    (fn: () => void) => {
      try {
        fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const actions = useMemo(
    () => ({
      confirmLine: (lineup: string[]) =>
        run(() => {
          if (!game || !log) return;
          const pointId = newId();
          commit(confirmLine(game, log, lineup, pointId), "confirmLine", {
            pointId,
            lineup,
          });
          setCarryOver(null);
        }),
      recordResult: (scorer: PointResult) =>
        run(() => {
          if (!game || !log) return;
          commit(recordResult(game, log, scorer), "recordResult", { scorer });
        }),
      callHalftime: () =>
        run(() => {
          if (!game || !log) return;
          commit(callHalftime(game, log), "halftime", {});
        }),
      callTimeout: (team: PointResult) =>
        run(() => {
          if (!log) return;
          commit(callTimeout(log, team), "timeout", { team });
        }),
      injurySub: (injuredPlayerId: string, replacementPlayerId: string) =>
        run(() => {
          if (!log) return;
          commit(injurySub(log, injuredPlayerId, replacementPlayerId), "injurySub", {
            injuredPlayerId,
            replacementPlayerId,
          });
          // Lock the injured player out of future lines this game (§8).
          setRoster(setRosterInjured(gameId, injuredPlayerId, true));
        }),
      editPointLineup: (pointId: string, lineup: string[]) =>
        run(() => {
          if (!log) return;
          commit(editPointLineup(log, pointId, lineup), "editLineup", {
            pointId,
            lineup,
          });
        }),
      endGame: () =>
        run(() => {
          if (!log) return;
          commit(endGame(log), "endGame", {});
          unregisterGame(gameId);
        }),
      undo: () =>
        run(() => {
          if (!game || !log) return;
          const result = undoLastPoint(game, log);
          commit(
            { points: result.points, meta: result.meta },
            "undo",
            {},
          );
          setCarryOver(result.restoredLineup);
          setPendingRedo(result.redo);
        }),
      redo: () =>
        run(() => {
          if (!game || !log || !pendingRedo) return;
          commit(replayRedo(game, log, pendingRedo), "redo", { pendingRedo });
          setCarryOver(null);
        }),
      // Saved-line mutations are best-effort: they still work from inside the
      // live game (sideline connectivity is unreliable), so a failure is
      // swallowed rather than surfaced as a game error, and the quick-lines bar
      // just falls back to its last-known-good cache (see savedLines.ts).
      saveLine: (name: string, playerIds: string[]) =>
        run(() => {
          if (!game) return;
          const scope = savedLinesScope(game);
          createSavedLine(scope, name, playerIds)
            .catch(() => {})
            .then(() => readSavedLines(scope))
            .then(setSavedLines);
        }),
      recordLineUsage: (id: string) =>
        run(() => {
          if (!game) return;
          const scope = savedLinesScope(game);
          incrementLineUsage(id)
            .catch(() => {})
            .then(() => readSavedLines(scope))
            .then(setSavedLines);
        }),
      setInjured: (playerId: string, injured: boolean) =>
        run(() => {
          setRoster(setRosterInjured(gameId, playerId, injured));
        }),
      resyncNow: () =>
        run(() => {
          if (!game || !log) return;
          setSyncState((s) => ({ ...s, status: "syncing" }));
          (async () => {
            const knownVersion = game.version;
            const result = await runSync();
            if (result.status !== "nothing-pending") {
              // synced/conflict/offline are already fully handled inside
              // runSync() (state + any "another device" message).
              if (result.status === "synced") setError(null);
              return;
            }
            // Nothing pending locally — check explicitly in case another
            // device has moved the game ahead of us since our last sync.
            try {
              const full = await api.get<GameFull>(`/games/${gameId}/full`);
              if (full.game.version !== knownVersion) {
                adoptServerState(full, false);
              } else {
                const now = new Date().toISOString();
                writeLastSyncedAt(gameId, now);
                setSyncState({ status: "synced", lastSyncedAt: now });
                setError(null);
              }
            } catch {
              setSyncState((s) => ({ ...s, status: "offline" }));
            }
          })();
        }),
      resolveFlip: async (patch: {
        fieldSide: "left" | "right";
        teamColor: "light" | "dark";
        startingOD: OD;
        startingGenderRatio?: GenderRatio;
      }) => {
        const updated = await resolveFlipApi(gameId, patch);
        setGame(updated);
      },
      undoFlip: async () => {
        const updated = await undoFlipApi(gameId);
        setGame(updated);
      },
    }),
    [game, log, roster, pendingRedo, commit, run, runSync, gameId, adoptServerState],
  );

  if (notFound) return { status: "not_found" };
  if (!game || !log || !state) return { status: "loading" };

  const canUndo =
    log.meta.endedManually ||
    log.points.length > 0 ||
    (log.meta.halftimeReached && !deriveHalftimeReached(game, log.points));

  // What undo would actually do, without applying it — undoLastPoint is a
  // pure reducer, so calling it just to read `.redo.type` is safe. This
  // keeps the label derivation identical to the real undo logic (see
  // packages/game-rules/src/state.ts) instead of a second, driftable copy.
  let undoLabel: string | null = null;
  if (canUndo) {
    try {
      undoLabel = `Undo ${REDO_ACTION_WORD[undoLastPoint(game, log).redo.type]}`;
    } catch {
      undoLabel = null;
    }
  }
  const redoLabel = pendingRedo ? `Redo ${REDO_ACTION_WORD[pendingRedo.type]}` : null;

  return {
    status: "ready",
    live: {
      game,
      roster,
      state,
      points: log.points,
      savedLines,
      carryOver,
      canUndo,
      canRedo: pendingRedo !== null,
      undoLabel,
      redoLabel,
      sync: syncState,
      actions,
      error,
    },
  };
}
