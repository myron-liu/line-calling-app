CREATE TABLE "game_roster" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"player_id" text NOT NULL,
	"name" text NOT NULL,
	"nickname" text,
	"gender_match" text NOT NULL,
	"role" text NOT NULL,
	"od_preference" text,
	"jersey_number" integer,
	"injured" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"tournament_id" text,
	"opponent_name" text NOT NULL,
	"game_cap" integer NOT NULL,
	"half_score" integer NOT NULL,
	"timeouts_per_half" integer NOT NULL,
	"starting_gender_ratio" text,
	"starting_od" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"halftime_reached" boolean DEFAULT false NOT NULL,
	"our_timeouts_remaining" integer NOT NULL,
	"their_timeouts_remaining" integer NOT NULL,
	"ended_manually" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"nickname" text,
	"gender_match" text NOT NULL,
	"role" text NOT NULL,
	"od_preference" text,
	"jersey_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"point_number" integer NOT NULL,
	"od" text NOT NULL,
	"gender_ratio" text,
	"lineup" jsonb NOT NULL,
	"substitutions" jsonb,
	"result" text,
	"is_first_after_halftime" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"player_ids" jsonb NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text DEFAULT 'public' NOT NULL,
	"name" text NOT NULL,
	"division" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_roster" (
	"id" text PRIMARY KEY NOT NULL,
	"tournament_id" text NOT NULL,
	"player_id" text NOT NULL,
	"injured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"division" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"started" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_roster" ADD CONSTRAINT "game_roster_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "points_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_lines" ADD CONSTRAINT "saved_lines_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_roster" ADD CONSTRAINT "tournament_roster_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_roster" ADD CONSTRAINT "tournament_roster_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_roster_unique" ON "game_roster" USING btree ("game_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "points_game_point_unique" ON "points" USING btree ("game_id","point_number");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_roster_unique" ON "tournament_roster" USING btree ("tournament_id","player_id");