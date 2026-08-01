CREATE TABLE "tournament_player_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"tournament_id" text NOT NULL,
	"player_id" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournament_player_tags" ADD CONSTRAINT "tournament_player_tags_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_player_tags" ADD CONSTRAINT "tournament_player_tags_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_player_tags_unique" ON "tournament_player_tags" USING btree ("tournament_id","player_id");--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "tags";