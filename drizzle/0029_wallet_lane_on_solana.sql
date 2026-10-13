-- The wallet lane settles in USDC on Solana (prompt 07 §4.2). A WALLET
-- recipient's address is now base58 (32 to 44 characters, case-sensitive, so
-- it is no longer lower-cased), and the wallet they use is a Solana wallet.
-- NOT VALID: rows saved by the earlier build keep their old address and
-- cannot be paid (the route re-validates before any send); every new or
-- edited row must be a Solana address.
ALTER TABLE "suppliers" DROP CONSTRAINT IF EXISTS "suppliers_wallet_shape_check";
--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_wallet_shape_check" CHECK (
  "payout_method" = 'BANK'
  OR (
    COALESCE("wallet_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$', false)
    AND COALESCE("wallet_provider" IN ('PHANTOM', 'SOLFLARE', 'BACKPACK', 'OTHER'), false)
  )
) NOT VALID;
--> statement-breakpoint
-- The outflow ledger records the Solana cluster. Earlier rows say 'mainnet'.
ALTER TABLE "stablecoin_outflows" DROP CONSTRAINT IF EXISTS "stablecoin_outflows_network_check";
--> statement-breakpoint
ALTER TABLE "stablecoin_outflows" ADD CONSTRAINT "stablecoin_outflows_network_check" CHECK ("network" IN ('devnet', 'mainnet-beta')) NOT VALID;
