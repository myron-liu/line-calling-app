ALTER TABLE "game_roster" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;