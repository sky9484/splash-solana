# Splash on Solana: build spec (Colosseum, deadline 12 Oct 2026)

Canon: Business Module v15.1 (locked 11 Oct). Design: `docs/solana-build/design-brief.md`.

## One flow, done properly
A Malaysian business pays a Philippine supplier's invoice in USDC on Solana devnet.
1. **Onboard:** sign in (app account only), company name, recovery kit (24 words made in the browser), device key (WebCrypto Ed25519, non-extractable). An autonomous Squads V4 vault is created: members device key + kit, threshold 1, `configAuthority` null.
2. **Fund:** devnet USDC to the vault.
3. **Invoice:** upload; Zeke's Reader extracts fields (quarantine, no tools); the person confirms each field; new bank details need out-of-band verification.
4. **Quote:** the engine compares (a) Solana direct to the payout partner's Solana deposit address and (b) CCTP V2 burn on Solana minting to the partner's Polygon deposit address. Ranked by PHP the supplier receives; Cheapest / Fastest / Safest.
5. **Policy:** tier, limits, KYT (stub labelled), duplicate invoice, quote expiry, bank details verified. Deterministic code; Zeke can't override.
6. **Approve:** the approval card (deterministic fields only) → device key signs the Squads proposal → approve → execute. Kora pays the network fee.
7. **Deliver:** the mock payout partner (labelled "Mock partner · devnet") returns a signed webhook: received, then paid with a bank reference.
8. **Prove:** the evidence bundle (kind 3) is built; leaves hashed; Merkle root anchored in a SAS attestation (or an SPL Memo fallback) on Solana; receipt page verifies.

## Invariants (tests must enforce)
- I-1 Splash holds no key that can move client money. No Splash member on any vault; `configAuthority` null.
- I-2 A payout's on-chain destination is the partner's one-payment deposit address (or the burn's `mintRecipient`). Never a Splash address.
- I-3 Kora's fee payer never sends SOL or USDC; only allowlisted programs (System for ATA rent only, SPL Token, ATA, Memo, Squads, CCTP V2, SAS, ComputeBudget).
- I-4 Every supplier payout needs a person's signature. No auto-execute path exists.
- I-5 Memos carry the salted invoice commitment only, never a name or invoice number.
- I-6 The approval card renders only deterministic fields (confirmed invoice + quote + policy result).
- I-7 Simulated (offline) receipts are always marked `simulated: true` and the UI says "Simulated".

## Layout
- `lib/solana/` chain core: `config.ts`, `recovery-kit.ts`, `device-key.ts`, `squads.ts`, `payout.ts`, `cctp-v2-solana.ts`, `kora.ts`, `kora.toml`, `simulator.ts`.
- `lib/route-engine/` quotes and ranking.
- `lib/solana-partner/` mock payout partner.
- `lib/solana-evidence/` bundle, Merkle, anchor.
- `lib/solana-zeke/` Reader/Router adapters (Claude when `ANTHROPIC_API_KEY` is set; deterministic offline otherwise).
- `app/solana/**` UI; `app/api/solana/**` routes.
- `scripts/solana-devnet-e2e.ts` run on a laptop with internet to produce real devnet signatures.
- Tests: `tests/solana-*.test.mjs` run with `npm run test:solana`.

## Run modes
- `SPLASH_SOLANA_MODE=offline` (default here): no network; every chain call goes through `simulator.ts`.
- `SPLASH_SOLANA_MODE=devnet`: real devnet via `SOLANA_RPC_URL`, `KORA_RPC_URL`.

## Claims
Say "payout partner", never "licensed". No partner names in UI. Say "you don't need SOL", never "gasless". No finality numbers. "Splash never holds the money."
