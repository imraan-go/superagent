CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"secret_enc" text NOT NULL,
	"target" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone,
	"fire_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
