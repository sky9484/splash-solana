-- Prompt 11 §4.3, "Fees kept inside Splash": on a payment into another Splash business's own account,
-- the payout fee the cheapest bank route would have charged for the same amount, recorded once when the
-- payment is quoted. Nothing is estimated after the fact: a payment without it stays null and is left out.
ALTER TABLE "solana_payments" ADD COLUMN "fee_avoided_minor" bigint;
