# Prior work disclosure

**Commit `4768824`** imports the Splash Sui build from `sky9484/phase1` at commit `3f78f5a` (26 Sep 2026), unchanged. It is prior work and not part of the Colosseum submission.

What it brought in and the Solana build reuses: the Next.js app shell and brand tokens (`styles/tokens.css`), copy and env guards (`scripts/check-copy.mjs`, `scripts/check-env-reads.mjs`), money helpers (`lib/money.ts`) and the test setup (`scripts/alias-hook.mjs`).

What is new for Colosseum (every commit after `4768824`):
- `lib/solana/` keys, Squads vault, payout, CCTP V2, Kora, simulator
- `lib/route-engine/`, `lib/solana-partner/`, `lib/solana-evidence/`, `lib/solana-zeke/`, `lib/solana-app/`
- `app/solana/`, `app/api/solana/`, `components/solana/`
- `tests/solana-*.test.mjs`, `tests/solana-ui.e2e.mjs`, `scripts/solana-devnet-e2e.ts`
- `docs/solana-build/`

The Sui build's own README is kept at `docs/prior-work/README-sui-build.md`. Its Sui Move packages under `move/` are not used by the Solana build.
