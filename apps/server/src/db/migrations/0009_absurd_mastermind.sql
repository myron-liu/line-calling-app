ALTER TABLE "saved_lines" DROP CONSTRAINT "saved_lines_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "saved_lines" ALTER COLUMN "tournament_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_lines" DROP COLUMN "team_id";