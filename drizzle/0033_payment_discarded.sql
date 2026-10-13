-- A person may discard a payment before anything is sent (lib/solana-app/payment-machine.ts,
-- DISCARDABLE_STATES): it moves to the terminal state "discarded", with its transition row, and
-- nothing on chain is touched. The two state checks gain the new state; nothing else changes.
ALTER TABLE "solana_payments" DROP CONSTRAINT "solana_payments_state_known";
--> statement-breakpoint
ALTER TABLE "solana_payments" ADD CONSTRAINT "solana_payments_state_known" CHECK ("state" IN ('draft', 'quoted', 'checked', 'proposed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored', 'quote_expired', 'rejected_by_policy', 'proposal_failed', 'execute_failed', 'partner_failed', 'evidence_failed', 'discarded'));
--> statement-breakpoint
ALTER TABLE "solana_payment_transitions" DROP CONSTRAINT "solana_payment_transitions_to_known";
--> statement-breakpoint
ALTER TABLE "solana_payment_transitions" ADD CONSTRAINT "solana_payment_transitions_to_known" CHECK ("to_state" IN ('draft', 'quoted', 'checked', 'proposed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored', 'quote_expired', 'rejected_by_policy', 'proposal_failed', 'execute_failed', 'partner_failed', 'evidence_failed', 'discarded'));
