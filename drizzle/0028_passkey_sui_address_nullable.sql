-- Passkeys are a sign-in / step-up factor on the Solana build, verified as
-- plain WebAuthn (lib/auth/webauthn.ts). They no longer derive a Sui address,
-- so new rows leave sui_address empty. Existing rows keep theirs; nothing
-- reads it. The column goes with the other Sui address columns in a later
-- migration.
ALTER TABLE "passkey_credentials" ALTER COLUMN "sui_address" DROP NOT NULL;
