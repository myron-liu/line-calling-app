// localStorage key namespacing (§10, §13.12/13.13).
// Every key is prefixed with `lca:v<schema>` so we can migrate or wipe a whole
// schema version at once. Each live game is an independent, namespaced log so
// multiple concurrent games never collide (§13.13).

export const NAMESPACE = "lca";
export const SCHEMA_VERSION = 1;

const prefix = `${NAMESPACE}:v${SCHEMA_VERSION}`;

export const keys = {
  /** Last-known-good /teams list, so the page renders instantly instead of a
   *  loading flash on every visit — see lib/cache.ts. */
  teams: `${prefix}:teams`,
  /** Last-known-good team + roster + tournaments for one team's detail page
   *  (a single blob since they're always fetched/compared together). */
  teamDetail: (teamId: string) => `${prefix}:team:${teamId}:detail-cache`,
  /** The team roster: every Player on a team (§4.1). */
  players: (teamId: string) => `${prefix}:team:${teamId}:players`,
  /** Tournaments belonging to a team (§4.2). */
  tournaments: (teamId: string) => `${prefix}:team:${teamId}:tournaments`,
  /** Check-in taps not yet flushed to the server (playerId -> desired
   *  present/injured state), so they survive a reload and don't need one
   *  request per tap — see lib/storage/tournaments.ts. */
  tournamentRosterPending: (tournamentId: string) =>
    `${prefix}:tournament:${tournamentId}:roster-pending`,
  /** Ids of games with a local log present — powers the game switcher. */
  gameIndex: `${prefix}:games`,
  /** The Game config (cap, ratio, starting O/D, timeouts) needed to derive state. */
  gameConfig: (gameId: string) => `${prefix}:game:${gameId}:config`,
  /** Append-only point log for one game (the source of truth). */
  gameLog: (gameId: string) => `${prefix}:game:${gameId}:log`,
  /** Explicit non-derived state for one game (timeouts, halftime flag, etc.). */
  gameMeta: (gameId: string) => `${prefix}:game:${gameId}:meta`,
  /** Snapshot of the eligible roster taken at Start, so it's readable offline. */
  gameRoster: (gameId: string) => `${prefix}:game:${gameId}:roster`,
  /** ISO timestamp of the last successful sync to the server, for the "Last
   *  synced" indicator and the manual resync button. */
  gameLastSync: (gameId: string) => `${prefix}:game:${gameId}:last-sync`,
  /** Reusable saved lines / pods, scoped to a team (§4.3). */
  savedLines: (teamId: string) => `${prefix}:team:${teamId}:saved-lines`,
  /** Pending mutations awaiting sync to the Bun server. */
  outbox: `${prefix}:outbox`,
} as const;

/** Prefix used when clearing/migrating an entire schema version. */
export const schemaPrefix = prefix;
