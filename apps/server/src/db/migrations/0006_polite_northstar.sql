CREATE TABLE "team_managers" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_managers" ADD CONSTRAINT "team_managers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_managers_phone_team_unique" ON "team_managers" USING btree ("phone","team_id");--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "owner_id";