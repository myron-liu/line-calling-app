// In-memory pub/sub for two independent kinds of live notifications. Bun.serve
// is single-process (see db/client.ts's identical assumption for the pooled db
// connection), so a module-level registry is fine — no need for Redis/etc.
//
// Channels are plain string keys into the same subscriber map, namespaced so
// the two kinds can never collide:
//  - a game's own id (GET /games/:id/events) — pushed when that game's
//    version changes, so a stale device learns about a conflicting write
//    immediately instead of only on its own next (rejected) sync attempt.
//  - savedLinesChannel(teamId) (GET /teams/:id/saved-lines/events) — pushed
//    whenever a saved line/pod is created/edited/used/deleted for that team.
//    This is deliberately unrelated to any game's version/conflict state:
//    saved lines are reusable pods, not part of a game's own transition
//    history, so a coach editing them on one device should just make every
//    other open device's saved-lines list refresh — never trigger a game
//    "stale, replaced with server data" notice (see useLiveGame.ts).

export type GameEvent =
  | { type: "updated"; version: number }
  | { type: "conflict"; version: number; rejectedVersion: number };

export type LinesEvent = { type: "updated" };

export function savedLinesChannel(teamId: string): string {
  return `lines:${teamId}`;
}

const subscribers = new Map<string, Set<ReadableStreamDefaultController>>();
const encoder = new TextEncoder();

export function subscribe(
  channel: string,
  controller: ReadableStreamDefaultController,
): void {
  let set = subscribers.get(channel);
  if (!set) {
    set = new Set();
    subscribers.set(channel, set);
  }
  set.add(controller);
}

export function unsubscribe(
  channel: string,
  controller: ReadableStreamDefaultController,
): void {
  const set = subscribers.get(channel);
  if (!set) return;
  set.delete(controller);
  if (set.size === 0) subscribers.delete(channel);
}

export function broadcast(channel: string, event: GameEvent | LinesEvent): void {
  const set = subscribers.get(channel);
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
