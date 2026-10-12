-- The Solana payment state machine (prompt 07 §5.1). Payments survive a restart, every state
-- change is a compare-and-set on (state, version) with an append-only transition row, and every
-- chain call is recorded under its idempotency key "paymentId:step" with its signature before the
-- bytes are broadcast (lib/solana-app/payment-repo.ts). Also the per-org daily sponsorship counter
-- (§5.6), incremented atomically before Kora is asked.
CREATE TABLE "solana_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"state" text NOT NULL,
	"version" integer NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solana_payments_state_known" CHECK ("state" IN ('draft', 'quoted', 'checked', 'proposed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored', 'quote_expired', 'rejected_by_policy', 'proposal_failed', 'execute_failed', 'partner_failed', 'evidence_failed')),
	CONSTRAINT "solana_payments_version_positive" CHECK ("version" >= 1),
	CONSTRAINT "solana_payments_id_shape" CHECK ("id" ~ '^(pay|bat)_[0-9a-f]{16}$')
);
--> statement-breakpoint
CREATE INDEX "solana_payments_org_idx" ON "solana_payments" ("org_id", "created_at");
--> statement-breakpoint
CREATE INDEX "solana_payments_state_idx" ON "solana_payments" ("state");
--> statement-breakpoint
CREATE TABLE "solana_payment_transitions" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"payment_id" text NOT NULL REFERENCES "solana_payments"("id"),
	"from_state" text,
	"to_state" text NOT NULL,
	"version" integer NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solana_payment_transitions_to_known" CHECK ("to_state" IN ('draft', 'quoted', 'checked', 'proposed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored', 'quote_expired', 'rejected_by_policy', 'proposal_failed', 'execute_failed', 'partner_failed', 'evidence_failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "solana_payment_transitions_version_unique" ON "solana_payment_transitions" ("payment_id", "version");
--> statement-breakpoint
CREATE TABLE "solana_chain_calls" (
	"key" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL REFERENCES "solana_payments"("id"),
	"step" text NOT NULL,
	"status" text NOT NULL,
	"signature" text NOT NULL,
	"last_valid_block_height" bigint,
	"logs" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solana_chain_calls_key_shape" CHECK ("key" = "payment_id" || ':' || "step"),
	CONSTRAINT "solana_chain_calls_status_known" CHECK ("status" IN ('signed', 'confirmed', 'finalized', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "solana_chain_calls_signature_unique" ON "solana_chain_calls" ("signature");
--> statement-breakpoint
CREATE INDEX "solana_chain_calls_payment_idx" ON "solana_chain_calls" ("payment_id");
--> statement-breakpoint
CREATE TABLE "solana_sponsor_usage" (
	"org_id" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solana_sponsor_usage_count_nonnegative" CHECK ("count" >= 0),
	CONSTRAINT "solana_sponsor_usage_day_shape" CHECK ("day" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "solana_sponsor_usage_org_day" ON "solana_sponsor_usage" ("org_id", "day");
