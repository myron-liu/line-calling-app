CREATE TABLE "users" (
	"phone" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
