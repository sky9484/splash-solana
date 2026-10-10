CREATE TABLE "org_policies" (
	"org_id" text PRIMARY KEY NOT NULL,
	"tier1_threshold_usd_micro" bigint NOT NULL,
	"dual_approval_threshold_usd_micro" bigint NOT NULL,
	"whitelisted_auto_kinds" jsonb NOT NULL,
	"operating_minimum_by_corridor" jsonb NOT NULL,
	"per_corridor_state" jsonb NOT NULL,
	"global_state" text DEFAULT 'ARMED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "version" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "approval_hash" text;--> statement-breakpoint
ALTER TABLE "org_policies" ADD CONSTRAINT "org_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;