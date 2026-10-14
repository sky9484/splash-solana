-- Prompt 10 §6.3, "Get paid": a company's payment requests, and the pay links someone else opens to pay
-- one, are documents beside its invoices. A request's money lands only in the requester's own account;
-- nothing here holds an account number.
ALTER TABLE "solana_documents" DROP CONSTRAINT "solana_documents_kind_known";
--> statement-breakpoint
ALTER TABLE "solana_documents" ADD CONSTRAINT "solana_documents_kind_known" CHECK ("kind" IN ('org', 'invoice', 'evidence', 'share', 'batch', 'request', 'paylink'));
