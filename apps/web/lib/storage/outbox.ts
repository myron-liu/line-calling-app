// Offline outbox (§10). Every game mutation is enqueued locally with a
// client-generated id + monotonic seq, then flushed to the Bun server
// opportunistically. The server dedupes/orders idempotently, so replaying the same
// event twice is a no-op.

import type { GameMeta, Point } from "@shared/game-rules";
import { ApiError, api } from "../api/client";
import { newId } from "../id";
import { keys } from "./keys";
import { read, write } from "./store";
import { writeGameConfig, writeLastSyncedAt, type GameFull, type RosterSnapshotEntry } from "./gameLog";

/** Mirrors the live-event endpoints in §9. */
export type OutboxEventType =
  | "start"
  | "confirmLine"
  | "recordResult"
  | "injurySub"
  | "editLineup"
  | "halftime"
  | "timeout"
  | "endGame"
  | "undo";

export interface OutboxEvent {
  /** Idempotency key; the server upserts on this. */
  id: string;
  gameId: string;
  type: OutboxEventType;
  payload: unknown;
  /** Monotonic per-device sequence for ordering. */
  seq: number;
  createdAt: string;
}

export function readOutbox(): OutboxEvent[] {
  return read<OutboxEvent[]>(keys.outbox, []);
}

function nextSeq(events: OutboxEvent[]): number {
  return events.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
}

export function enqueue(
  gameId: string,
  type: OutboxEventType,
  payload: unknown,
): OutboxEvent {
  const events = readOutbox();
  const event: OutboxEvent = {
    id: newId(),
    gameId,
    type,
    payload,
    seq: nextSeq(events),
    createdAt: new Date().toISOString(),
  };
  write(keys.outbox, [...events, event]);
  return event;
}

/** Remove events the server has acknowledged. */
export function ack(eventIds: string[]): void {
  const acked = new Set(eventIds);
  write(
    keys.outbox,
    readOutbox().filter((e) => !acked.has(e.id)),
  );
}

/** Drop every pending event for a game without acking it to the server — used
 *  when a manual resync adopts the server's state wholesale, which supersedes
 *  whatever local changes those events represented (see useLiveGame's resyncNow). */
export function dropPending(gameId: string): void {
  write(
    keys.outbox,
    readOutbox().filter((e) => e.gameId !== gameId),
  );
}

export function pendingCount(): number {
  return readOutbox().length;
}

export function pendingCountFor(gameId: string): number {
  return readOutbox().filter((e) => e.gameId === gameId).length;
}

export type FlushResult =
  | { status: "synced" }
  | { status: "conflict"; full: GameFull }
  | { status: "offline" }
  | { status: "nothing-pending" };

/**
 * Push the game's full current state (meta + points + roster + the version last
 * seen) to the server and ack every pending event for it, or no-op if there's
 * nothing pending. The server's `PUT /games/:id/sync` replaces its copy
 * wholesale rather than replaying individual events (see
 * apps/server/src/db/queries.ts's syncGame), so there's no need to send the
 * queue itself — just whatever the client already computed.
 *
 * A stale `version` (another device synced this game since we last did) comes
 * back as a 409 with the server's current full state attached — returned here
 * as `{ status: "conflict", full }` rather than retried, since blindly retrying
 * the same push would just fail again. The caller decides how to reconcile
 * (see useLiveGame's resyncNow); plain network failures are returned as
 * `"offline"` and are expected to be retried on the next commit.
 */
export async function flush(
  gameId: string,
  state: {
    version: number;
    meta: GameMeta;
    points: Point[];
    roster: RosterSnapshotEntry[];
  },
): Promise<FlushResult> {
  const pending = readOutbox().filter((e) => e.gameId === gameId);
  if (pending.length === 0) return { status: "nothing-pending" };
  try {
    const full = await api.put<GameFull>(`/games/${gameId}/sync`, state);
    ack(pending.map((e) => e.id));
    writeGameConfig(full.game);
    writeLastSyncedAt(gameId, new Date().toISOString());
    return { status: "synced" };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      return { status: "conflict", full: err.body as GameFull };
    }
    return { status: "offline" };
  }
}
