-- The Solana app's per-company records that are not payments: the company
-- record (salt, verified suppliers, fundings, the refuse-service switch), its
-- invoices, its evidence, and the receipt share links it minted.
--
-- Payments already live in solana_payments with compare-and-set (0030). These
-- are documents: each is read whole when a company's first request arrives and
-- written back whole when a request changes it. Last writer wins, which is fine
-- for records only that company edits; anything that moves money is a payment
-- and goes through the state machine instead.
--
-- body is the record as JSON with bigint kept exact ({"$bigint": "..."}).
-- Nothing here is a secret a person holds: no recovery words, no private key.
CREATE TABLE "solana_documents" (
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"org_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solana_documents_pk" PRIMARY KEY ("kind", "id"),
	CONSTRAINT "solana_documents_kind_known" CHECK ("kind" IN ('org', 'invoice', 'evidence', 'share'))
);
--> statement-breakpoint
CREATE INDEX "solana_documents_org_idx" ON "solana_documents" ("org_id", "kind");
