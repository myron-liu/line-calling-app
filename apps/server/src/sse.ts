// In-memory pub/sub for live-game conflict notifications. Bun.serve is
// single-process (see db/client.ts's identical assumption for the pooled db
// connection), so a module-level registry is fine — no need for Redis/etc.
// Clients subscribe per game via SSE (GET /games/:id/events) and get pushed
// an event whenever that game's version changes, so a stale device learns
// about a conflicting write immediately instead of only on its own next
// (rejected) sync attempt.

export type GameEvent =
  | { type: "updated"; version: number }
  | { type: "conflict"; version: number; rejectedVersion: number };

const subscribers = new Map<string, Set<ReadableStreamDefaultController>>();
const encoder = new TextEncoder();

export function subscribe(
  gameId: string,
  controller: ReadableStreamDefaultController,
): void {
  let set = subscribers.get(gameId);
  if (!set) {
    set = new Set();
    subscribers.set(gameId, set);
  }
  set.add(controller);
}

export function unsubscribe(
  gameId: string,
  controller: ReadableStreamDefaultController,
): void {
  const set = subscribers.get(gameId);
  if (!set) return;
  set.delete(controller);
  if (set.size === 0) subscribers.delete(gameId);
}

export function broadcast(gameId: string, event: GameEvent): void {
  const set = subscribers.get(gameId);
  if (!set || set.size === 0) return;
  const payload = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  for (const controller of set) {
    try {
      controller.enqueue(payload);
    } catch {
      // Dead controller — its own stream's cancel() will unsubscribe it.
    }
  }
}
