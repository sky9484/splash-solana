-- What the Kora fee payer spent for each company, per UTC day, next to the count of sponsored
-- transactions (0030). The admin console's fee payer section reads these.
--
-- fee_lamports is exact: 5,000 lamports per signature plus the priority fee, read from each
-- transaction. rent_lamports is the rent the fee payer put into accounts the send created (token
-- accounts, Squads proposals). Splash's vaults set no rent collector, so that rent does not come back.
-- Integers only; never a float.
ALTER TABLE "solana_sponsor_usage" ADD COLUMN "fee_lamports" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "solana_sponsor_usage" ADD COLUMN "rent_lamports" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "solana_sponsor_usage" ADD CONSTRAINT "solana_sponsor_usage_spend_nonnegative" CHECK ("fee_lamports" >= 0 AND "rent_lamports" >= 0);
