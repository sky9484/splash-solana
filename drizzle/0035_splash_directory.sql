-- Prompt 10 §5.4: "Find a business on Splash". A company chooses to be found (off by default), under a
-- handle. Only ACTIVE companies with an account show (lib/server/splash-directory.ts).
ALTER TABLE "organizations" ADD COLUMN "discoverable" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "splash_handle" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_splash_handle_shape" CHECK ("splash_handle" IS NULL OR "splash_handle" ~ '^[a-z0-9][a-z0-9-]{2,30}$');
--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_splash_handle_unique" ON "organizations" ("splash_handle");
