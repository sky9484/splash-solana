CREATE TABLE "passkey_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"sui_address" text NOT NULL,
	"rp_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credentials_credential_unique" ON "passkey_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credentials_active_user_rp_unique" ON "passkey_credentials" USING btree ("user_id","rp_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "passkey_credentials_address_idx" ON "passkey_credentials" USING btree ("sui_address");
