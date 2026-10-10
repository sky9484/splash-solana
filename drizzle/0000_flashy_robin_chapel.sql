CREATE TYPE "public"."intent_state" AS ENUM('AUTHORIZED', 'DEPOSIT_CONFIRMED', 'EXCHANGING', 'EXCHANGED', 'QUEUED', 'SETTLING', 'SETTLED', 'SWEEPING', 'DISBURSED', 'CREDITED', 'FAILED', 'REFUNDING', 'REFUNDED', 'OPS_HOLD', 'COMPLIANCE_HOLD');--> statement-breakpoint
CREATE TYPE "public"."kyb_status" AS ENUM('none', 'pending', 'basic', 'full', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('DRAFT', 'SIMULATED', 'POLICY_EVALUATED', 'PENDING_APPROVAL', 'APPROVED', 'SIGNED', 'SUBMITTED', 'REJECTED', 'EXPIRED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."screening_verdict" AS ENUM('CLEAR', 'REVIEW', 'BLOCK', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('maker', 'checker', 'admin', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('RECEIVED', 'PROCESSED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"signature_ref" text,
	"signed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_anchors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"batch_date" text NOT NULL,
	"walrus_blob_id" text,
	"audit_hash" text,
	"sui_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"reason" text,
	"released_by" text,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"session_id" text NOT NULL,
	"provider" text NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"provider_reference" text,
	"kyt_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intent_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text,
	"issuer_org" text NOT NULL,
	"payer_name" text,
	"payer_email" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"target_currency" text NOT NULL,
	"due_date" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"memo" text,
	"walrus_blob_id" text,
	"seal_policy_id" text,
	"pay_link_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"kind" text NOT NULL,
	"intent_id" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_postings" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_id" text NOT NULL,
	"account" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"kyb_status" "kyb_status" DEFAULT 'none' NOT NULL,
	"kyb_tier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text,
	"invoice_id" text,
	"state" "intent_state" NOT NULL,
	"source_amount_minor" bigint NOT NULL,
	"source_currency" text NOT NULL,
	"target_amount_minor" bigint NOT NULL,
	"target_currency" text NOT NULL,
	"fee_minor" bigint,
	"exchange_rate" numeric,
	"quote_id" text,
	"quote_expires_at" timestamp with time zone,
	"funding_session_id" text,
	"funding_method" text,
	"funding_provider" text,
	"sui_tx_digest" text,
	"receipt_object_id" text,
	"walrus_blob_id" text,
	"audit_anchor_id" text,
	"failure_reason" text,
	"failed_at_state" text,
	"demo" boolean DEFAULT false NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"intent_id" text,
	"rail" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" "proposal_status" NOT NULL,
	"tier" text NOT NULL,
	"corridor" text,
	"created_by" text NOT NULL,
	"unsigned_tx_bytes" text,
	"explain" jsonb NOT NULL,
	"simulation" jsonb,
	"required_approvers" bigint DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_results" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"provider" text NOT NULL,
	"verdict" "screening_verdict" NOT NULL,
	"risk_score" numeric,
	"raw" jsonb,
	"screened_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"bank_name" text,
	"swift" text,
	"account_ref" text,
	"kyb_status" "kyb_status" DEFAULT 'none' NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_status" DEFAULT 'RECEIVED' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_anchors" ADD CONSTRAINT "audit_anchors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_cases" ADD CONSTRAINT "compliance_cases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_events" ADD CONSTRAINT "funding_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_transitions" ADD CONSTRAINT "intent_transitions_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_journal_id_journal_entries_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_results" ADD CONSTRAINT "screening_results_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_moves" ADD CONSTRAINT "treasury_moves_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_one_per_user" ON "approvals" USING btree ("proposal_id","user_id");--> statement-breakpoint
CREATE INDEX "cases_subject_idx" ON "compliance_cases" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "funding_org_idx" ON "funding_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funding_provider_ref_unique" ON "funding_events" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "transitions_intent_idx" ON "intent_transitions" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "invoices_org_idx" ON "invoices" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invoices_supplier_idx" ON "invoices" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_pay_link_unique" ON "invoices" USING btree ("pay_link_slug");--> statement-breakpoint
CREATE INDEX "journal_intent_idx" ON "journal_entries" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "postings_journal_idx" ON "ledger_postings" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "postings_account_idx" ON "ledger_postings" USING btree ("account","currency");--> statement-breakpoint
CREATE INDEX "intents_org_idx" ON "payment_intents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "intents_supplier_idx" ON "payment_intents" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "intents_state_idx" ON "payment_intents" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "intents_idempotency_unique" ON "payment_intents" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payouts_intent_idx" ON "payouts" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "proposals_org_idx" ON "proposals" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "proposals_status_idx" ON "proposals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_idempotency_unique" ON "proposals" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "screening_subject_idx" ON "screening_results" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "suppliers_org_idx" ON "suppliers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "treasury_org_idx" ON "treasury_moves" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_unique" ON "webhook_events" USING btree ("provider","event_id");