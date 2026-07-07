// Server-generated IDs for entities created through this API (teams, players,
// tournaments, saved lines, games). Unlike the frontend's client-generated IDs
// (apps/web/lib/id.ts, used for offline point-log writes), these entities are
// "online-only" by design (§13.12), so there's no need for the client to
// pre-generate an id before the round trip — the server just assigns one.
export function newId(): string {
  return crypto.randomUUID();
}
