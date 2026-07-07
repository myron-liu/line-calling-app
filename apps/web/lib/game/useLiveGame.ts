"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  callHalftime,
  callTimeout,
  confirmLine,
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
  type LiveGameState,
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
  type OutboxEventType,
} from "@/lib/storage/outbox";
import {
  createSavedLine,
  deleteSavedLine,
  incrementLineUsage,
  readSavedLines,
} from "@/lib/storage/savedLines";

/** Saved lines are team-scoped (§4.3). */
const savedLinesScope = (game: Game): string => game.teamId;

/** Sync status for the "Last synced" indicator + manual resync button (§ live
 *  caller shell). "conflict" means an automatic flush was rejected because
 *  another device synced this game more recently — resolved via resyncNow. */
export type SyncStatusKind = "idle" | "syncing" | "synced" | "conflict" | "offline";

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
    deleteLine: (id: string) => void;
    recordLineUsage: (id: string) => void;
    setInjured: (playerId: string, injured: boolean) => void;
    /** Manually push pending local changes, or — if rejected as stale, or if
     *  there's nothing local to push — pull the server's current state and
     *  adopt it (discarding any unsynced local changes; see queries.ts's
     *  syncGame for why a stale push is rejected instead of overwriting). */
    resyncNow: () => void;
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

  // Real-time conflict notifications (see apps/server/src/sse.ts): while this
  // game is open, learn about another device's write immediately instead of
  // only on our own next (rejected) sync attempt. Whether the pushed version
  // came from a clean write or one that bounced someone else's stale attempt
  // doesn't change what *we* should do with it: if we have nothing pending,
  // a newer version is harmless to adopt quietly; if we do, our own base is
  // now stale, so surface a conflict instead (commit() below refuses to
  // write further until the coach resolves it via resyncNow) rather than
  // silently discarding or clobbering either side.
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
      if (pendingCountFor(gameId) > 0) {
        setSyncState((s) => ({ ...s, status: "conflict" }));
        return;
      }
      api
        .get<GameFull>(`/games/${gameId}/full`)
        .then((full) => adoptServerState(full, false))
        .catch(() => {});
    };
    return () => source.close();
  }, [gameId, adoptServerState]);

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
    // flush() itself no-ops if there's nothing pending. A conflict here is
    // surfaced (not auto-resolved) — the coach resolves it via resyncNow, so an
    // automatic background pass never silently discards local changes.
    flush(gameId, {
      version: game.version,
      meta: readMeta(gameId) ?? defaultMeta(game),
      points: readLog(gameId),
      roster: readRosterSnapshot(gameId),
    }).then((result) => {
      if (result.status === "synced") {
        const updated = readGameConfig(gameId);
        if (updated) setGame(updated);
        setSyncState({ status: "synced", lastSyncedAt: readLastSyncedAt(gameId) });
      } else if (result.status === "conflict" || result.status === "offline") {
        setSyncState((s) => ({ ...s, status: result.status }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, gameId]);

  const state = useMemo(
    () => (game && log ? deriveLiveGameState(game, log.points, log.meta) : null),
    [game, log],
  );

  /** Persist a new log state, mirror to the outbox, and best-effort sync.
   *  Refuses to write at all while a conflict is outstanding (surfaced by
   *  either a rejected flush or the real-time SSE notification above) — the
   *  coach must resolve it via resyncNow first, rather than the local log
   *  drifting further from a base the server already moved past. */
  const commit = useCallback(
    (next: GameLogState, type: OutboxEventType, payload: unknown) => {
      if (syncState.status === "conflict") {
        setError(
          "This game was updated on another device — tap “Sync now” above before making further changes.",
        );
        return;
      }
      // Any real log mutation invalidates a pending redo — it was only ever
      // valid for replaying exactly the undo that produced it. undo() and
      // redo() themselves set the redo state explicitly right after this.
      setPendingRedo(null);
      writeLog(gameId, next.points);
      writeMeta(gameId, next.meta);
      enqueue(gameId, type, payload);
      setLog(next);
      setError(null);
      if (!game) return;
      // A conflict here means another device synced this game more recently —
      // surfaced via syncState, not auto-resolved (see resyncNow). Otherwise
      // blind retries on every subsequent action would just keep failing.
      flush(gameId, {
        version: game.version,
        meta: next.meta,
        points: next.points,
        roster: readRosterSnapshot(gameId),
      }).then((result) => {
        if (result.status === "synced") {
          const updated = readGameConfig(gameId);
          if (updated) setGame(updated);
          setSyncState({ status: "synced", lastSyncedAt: readLastSyncedAt(gameId) });
        } else if (result.status === "conflict" || result.status === "offline") {
          setSyncState((s) => ({ ...s, status: result.status }));
        }
      });
    },
    [gameId, game, syncState.status],
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
      deleteLine: (id: string) =>
        run(() => {
          if (!game) return;
          const scope = savedLinesScope(game);
          deleteSavedLine(id)
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
            const result = await flush(gameId, {
              version: game.version,
              meta: log.meta,
              points: log.points,
              roster,
            });
            if (result.status === "synced") {
              const updated = readGameConfig(gameId);
              if (updated) setGame(updated);
              setSyncState({ status: "synced", lastSyncedAt: readLastSyncedAt(gameId) });
              setError(null);
              return;
            }
            if (result.status === "conflict") {
              adoptServerState(result.full, true);
              return;
            }
            if (result.status === "offline") {
              setSyncState((s) => ({ ...s, status: "offline" }));
              return;
            }
            // Nothing pending locally — check explicitly in case another
            // device has moved the game ahead of us since our last sync.
            try {
              const full = await api.get<GameFull>(`/games/${gameId}/full`);
              if (full.game.version !== game.version) {
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
    }),
    [game, log, roster, pendingRedo, commit, run, gameId, adoptServerState],
  );

  if (notFound) return { status: "not_found" };
  if (!game || !log || !state) return { status: "loading" };

  return {
    status: "ready",
    live: {
      game,
      roster,
      state,
      points: log.points,
      savedLines,
      carryOver,
      canUndo: log.meta.endedManually || log.points.length > 0,
      canRedo: pendingRedo !== null,
      sync: syncState,
      actions,
      error,
    },
  };
}
