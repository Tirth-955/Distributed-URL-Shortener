CREATE TABLE "urls" (
	"id" serial PRIMARY KEY NOT NULL,
	"short_code" varchar(12) NOT NULL,
	"original_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "urls_short_code_unique" UNIQUE("short_code")
);
