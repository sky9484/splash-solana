-- Solana account setup: which device signs for which member, and which
-- Squads vault belongs to which organisation.
--
-- member_devices holds PUBLIC keys only. The private half of a device key is
-- a non-extractable WebCrypto key in the member's browser (IndexedDB) and
-- never reaches the server. A row is written only after the browser proved
-- possession by signing a server nonce (lib/solana/recovery-kit.ts
-- verifyPossession). One active device per member per organisation for now;
-- adding a second device is a vault config transaction, approved on-chain.
--
-- org_vaults records the autonomous vault created for an organisation. The
-- CHECK on config_authority_null is the I-1 invariant at the database edge:
-- a vault with a config authority (anyone, including Splash, able to change
-- its members) can never be recorded as an organisation's vault.
CREATE TABLE "member_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id"),
	"org_id" text NOT NULL REFERENCES "organizations"("id"),
	"public_key" text NOT NULL,
	"label" text DEFAULT 'This device' NOT NULL,
	"proven_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_devices_public_key_unique" ON "member_devices" ("public_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "member_devices_one_active_per_member" ON "member_devices" ("user_id", "org_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "member_devices_org_idx" ON "member_devices" ("org_id");
--> statement-breakpoint
CREATE TABLE "org_vaults" (
	"org_id" text PRIMARY KEY NOT NULL REFERENCES "organizations"("id"),
	"cluster" text NOT NULL,
	"simulated" boolean NOT NULL,
	"multisig_pda" text NOT NULL,
	"vault_pda" text NOT NULL,
	"threshold" integer NOT NULL,
	"members" jsonb NOT NULL,
	"config_authority_null" boolean NOT NULL,
	"create_signature" text NOT NULL,
	"created_by" text NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_vaults_autonomous" CHECK ("config_authority_null" = true),
	CONSTRAINT "org_vaults_threshold_positive" CHECK ("threshold" >= 1),
	CONSTRAINT "org_vaults_cluster_known" CHECK ("cluster" IN ('devnet', 'mainnet-beta'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_vaults_multisig_unique" ON "org_vaults" ("multisig_pda");
--> statement-breakpoint
CREATE UNIQUE INDEX "org_vaults_vault_unique" ON "org_vaults" ("vault_pda");
