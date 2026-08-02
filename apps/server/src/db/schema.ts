// Drizzle schema — the durable mirror of @shared/game-rules' domain types (§4 of
// the design doc). IDs are client-generated UUIDs (text, not serial) everywhere,
// since the frontend creates entities offline before they ever reach the server
// (see apps/web/lib/id.ts) — the server treats them as canonical and upserts on
// them, which is what makes the live-game sync endpoint idempotent.

import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ── Teams & players ──────────────────────────────────────────────────────────

export const teams = pgTable("teams", {
  id: id(),
  name: text("name").notNull(),
  division: text("division").notNull(), // "mixed" | "open" | "women"
  createdAt: createdAt(),
  // Soft delete: "deleting" a team from the UI just hides it (see
  // listTeamsForManager/getTeam filtering it out) rather than removing any
  // row — the team and all its child data (players, tournaments, games,
  // saved lines) stay intact and restorable via a one-off script if asked.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// Many-to-many: a phone number (the verified identity from a Supabase phone-
// auth JWT — see src/auth.ts) can manage multiple teams, and a team can have
// multiple managers. Flat role — no tiers. Whoever creates a team is inserted
// here automatically; any existing manager can add/remove others (see
// routes.ts's manager-list routes).
export const teamManagers = pgTable(
  "team_managers",
  {
    id: id(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(), // canonical E.164, e.g. "+14155550123"
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("team_managers_phone_team_unique").on(t.phone, t.teamId)],
);

// Display name for a verified phone identity (§4.0's User) — separate from
// Supabase Auth's own user_metadata copy of the same name (set at sign-up,
// see lib/auth/auth-context.tsx's updateProfile) so the server can join it
// into team_managers listings without needing the Supabase Admin API. Phone
// is the natural key: one profile per verified identity, upserted on sign-up.
export const users = pgTable("users", {
  phone: text("phone").primaryKey(), // canonical E.164
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  createdAt: createdAt(),
});

export const players = pgTable("players", {
  id: id(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nickname: text("nickname"),
  genderMatch: text("gender_match").notNull(), // "MMP" | "WMP"
  role: text("role").notNull(), // "handler" | "cutter" | "both"
  odPreference: text("od_preference"), // "O" | "D" | "both" | null
  jerseyNumber: integer("jersey_number"),
  createdAt: createdAt(),
});

// ── Tournaments & check-in roster ────────────────────────────────────────────

export const tournaments = pgTable("tournaments", {
  id: id(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  division: text("division").notNull(),
  startDate: text("start_date").notNull(), // ISO date, kept as text to match Game
  endDate: text("end_date"),
  started: boolean("started").notNull().default(false),
  createdAt: createdAt(),
});

export const tournamentRoster = pgTable(
  "tournament_roster",
  {
    id: id(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    injured: boolean("injured").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tournament_roster_unique").on(t.tournamentId, t.playerId)],
);

// Free-form coach-assigned labels, distinct from role/O-D preference (e.g.
// "Zone D specialist", "Rookie") — tournament-scoped like saved lines/pods,
// since a team often reuses the same roster differently across tournaments.
// Deliberately its own table rather than a column on tournamentRoster: that
// table's row is deleted outright when a player is marked not-present at
// check-in (see batchUpdateTournamentRoster), which would silently destroy
// any tags stored there too. Reused across players the same way
// SavedLine.tags works: no separate managed list, just whatever string
// values are currently in use. Filterable in the live caller's line builder.
export const tournamentPlayerTags = pgTable(
  "tournament_player_tags",
  {
    id: id(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    tags: jsonb("tags").notNull().default([]).$type<string[]>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tournament_player_tags_unique").on(t.tournamentId, t.playerId)],
);

// ── Saved lines / pods ───────────────────────────────────────────────────────

export const savedLines = pgTable("saved_lines", {
  id: id(),
  // A team's lines/pods are scoped per-tournament (§4.3) — a team often
  // reuses the same roster across several tournaments with different needs
  // each time, so there's no team-wide pool anymore.
  tournamentId: text("tournament_id")
    .notNull()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  playerIds: jsonb("player_ids").notNull().$type<string[]>(),
  useCount: integer("use_count").notNull().default(0),
  color: text("color"), // "red" | "green" | "blue" | "yellow" | "black" | "purple" | null
  side: text("side"), // "O" | "D" | "both" | null
  hidden: boolean("hidden").notNull().default(false),
  // Free-form coach-assigned labels for organizing/filtering lines & pods in
  // the editor (e.g. "zone-D", "starters") — unlike color/side, not a fixed enum.
  tags: jsonb("tags").notNull().default([]).$type<string[]>(),
  createdAt: createdAt(),
});

// ── Games ────────────────────────────────────────────────────────────────────
// Meta (§ GameMeta) is folded directly onto the row — it's always 1:1 with a
// game and small, so a join would just add cost with no benefit.

export const games = pgTable("games", {
  id: id(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  tournamentId: text("tournament_id").references(() => tournaments.id, {
    onDelete: "set null",
  }),
  opponentName: text("opponent_name").notNull(),
  // 13 | 15, or null for a "time cap" game — no score ends it automatically,
  // only a manual End game does (see GameCapMode in @shared/game-rules).
  gameCap: integer("game_cap"),
  halfScore: integer("half_score"), // null alongside a null gameCap
  timeoutsPerHalf: integer("timeouts_per_half").notNull(),
  startingGenderRatio: text("starting_gender_ratio"), // "4MMP_3WMP" | "4WMP_3MMP" | null
  // "O" | "D" — a real value once in_progress; while status is "scheduled"
  // this holds an unread placeholder until the flip-result form resolves it
  // (see queries.ts's createGame / resolveFlip).
  startingOD: text("starting_od").notNull(),
  status: text("status").notNull().default("in_progress"),

  // Administrative details, all optional (§ create-game-form).
  fieldNumber: text("field_number"),
  gameDate: text("game_date"), // ISO date, kept as text to match Tournament
  startTime: text("start_time"),
  opposingCoachName: text("opposing_coach_name"),
  // Time caps in minutes from the first confirmed line (§ cap banners).
  halfCapMinutes: integer("half_cap_minutes"),
  softCapMinutes: integer("soft_cap_minutes"),
  hardCapMinutes: integer("hard_cap_minutes"),
  // Resolved by the post-creation flip-result step, not asked upfront, since
  // they're only known after the actual disc flip — null until then.
  fieldSide: text("field_side"), // "left" | "right" | null
  teamColor: text("team_color"), // "light" | "dark" | null

  // Optimistic-concurrency counter for PUT /games/:id/sync — see syncGame.
  version: integer("version").notNull().default(1),

  // GameMeta — non-derivable live state (§7).
  halftimeReached: boolean("halftime_reached").notNull().default(false),
  ourTimeoutsRemaining: integer("our_timeouts_remaining").notNull(),
  theirTimeoutsRemaining: integer("their_timeouts_remaining").notNull(),
  endedManually: boolean("ended_manually").notNull().default(false),

  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Roster snapshot frozen at Start, kept in sync with tournament check-in
// afterward (§13.12) — entries are never deleted so line history keeps resolving
// player names even after someone's removed from the roster.
export const gameRoster = pgTable(
  "game_roster",
  {
    id: id(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull(),
    name: text("name").notNull(),
    nickname: text("nickname"),
    genderMatch: text("gender_match").notNull(),
    role: text("role").notNull(),
    odPreference: text("od_preference"),
    jerseyNumber: integer("jersey_number"),
    injured: boolean("injured").notNull().default(false),
    active: boolean("active").notNull().default(true),
    // Mirrors players.tags at snapshot time, kept in sync the same way the
    // rest of this row is (see syncTournamentGameRosters).
    tags: jsonb("tags").notNull().default([]).$type<string[]>(),
  },
  (t) => [uniqueIndex("game_roster_unique").on(t.gameId, t.playerId)],
);

// The point log — the source of truth for the live game (§7). `lineup` and
// `substitutions` are small arrays/objects, stored as jsonb rather than
// normalized into their own tables since they're never queried independently.
export const points = pgTable(
  "points",
  {
    id: id(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    pointNumber: integer("point_number").notNull(),
    od: text("od").notNull(),
    genderRatio: text("gender_ratio"),
    lineup: jsonb("lineup").notNull().$type<string[]>(),
    substitutions: jsonb("substitutions").$type<
      { injuredPlayerId: string; replacementPlayerId: string }[]
    >(),
    result: text("result"), // "us" | "them" | null (in progress)
    isFirstAfterHalftime: boolean("is_first_after_halftime")
      .notNull()
      .default(false),
    // Game clock (§8): startedAt is set when the line is confirmed, endedAt
    // when the result is recorded. Null for points synced before this
    // existed, or (startedAt only) while a point is still in progress.
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // Recorded stats (§ stats): Ds/turnovers tapped in while the point was
    // live, and how a point we won was scored. Both null for points played
    // before stat recording existed.
    statEvents: jsonb("stat_events").$type<
      { id: string; playerId: string; type: "block" | "turnover" }[]
    >(),
    strategyTags: jsonb("strategy_tags").$type<string[]>(),
    scoring: jsonb("scoring").$type<
      | { kind: "goal"; assistPlayerId?: string; goalPlayerId: string }
      | { kind: "callahan"; playerId: string }
    >(),
  },
  (t) => [uniqueIndex("points_game_point_unique").on(t.gameId, t.pointNumber)],
);
