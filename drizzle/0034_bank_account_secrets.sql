-- Prompt 10 Phase S: full bank account numbers, sealed (docs/security/PII-STORAGE.md). The one table
-- that holds them; every other table keeps the record's id and last4.
CREATE TABLE "bank_account_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"beneficiary_id" text NOT NULL,
	"ciphertext" text,
	"nonce" text,
	"wrapped_data_key" text,
	"key_id" text NOT NULL,
	"last4" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_at" timestamp with time zone,
	"shred_after" timestamp with time zone,
	"shredded_at" timestamp with time zone,
	CONSTRAINT "bank_account_secrets_last4" CHECK ("last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "bank_account_secrets_sealed_or_shredded" CHECK (
		("shredded_at" IS NULL AND "ciphertext" IS NOT NULL AND "nonce" IS NOT NULL AND "wrapped_data_key" IS NOT NULL)
		OR ("shredded_at" IS NOT NULL AND "ciphertext" IS NULL AND "nonce" IS NULL AND "wrapped_data_key" IS NULL)
	)
);
--> statement-breakpoint
CREATE INDEX "bank_account_secrets_beneficiary_idx" ON "bank_account_secrets" ("org_id", "beneficiary_id");
--> statement-breakpoint
CREATE INDEX "bank_account_secrets_fingerprint_idx" ON "bank_account_secrets" ("org_id", "fingerprint");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_account_secrets_one_current" ON "bank_account_secrets" ("org_id", "beneficiary_id") WHERE "replaced_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "bank_account_secrets_shred_idx" ON "bank_account_secrets" ("shred_after") WHERE "shredded_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "bank_account_reveals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"beneficiary_id" text NOT NULL,
	"secret_id" text,
	"user_id" text NOT NULL,
	"result" text NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_account_reveals_result" CHECK ("result" IN ('challenged', 'revealed', 'refused'))
);
--> statement-breakpoint
CREATE INDEX "bank_account_reveals_org_idx" ON "bank_account_reveals" ("org_id", "at");
