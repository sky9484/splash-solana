CREATE TABLE "wallet_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"sui_address" text NOT NULL,
	"oauth_iss" text NOT NULL,
	"oauth_sub" text NOT NULL,
	"oauth_aud" text NOT NULL,
	"email_at_login" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "kyb_lifecycle" text DEFAULT 'REGISTERED' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "sui_business_account_id" text;--> statement-breakpoint
ALTER TABLE "wallet_identities" ADD CONSTRAINT "wallet_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_identities" ADD CONSTRAINT "wallet_identities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_identities_sui_address_unique" ON "wallet_identities" USING btree ("sui_address");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_identities_oauth_subject_unique" ON "wallet_identities" USING btree ("oauth_iss","oauth_sub","oauth_aud");--> statement-breakpoint
CREATE INDEX "wallet_identities_user_idx" ON "wallet_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_identities_org_idx" ON "wallet_identities" USING btree ("org_id");