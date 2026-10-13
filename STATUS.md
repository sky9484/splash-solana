# Splash on Solana — status

**Build:** the Solana build for Colosseum (prompt 07, "Solana everywhere, proof on Walrus"), on devnet and the offline simulator.
**Governing constraint:** Splash **never holds the money.** Each business's USDC sits in its own Squads V4 multisig on Solana, with no config authority and no Splash key among its members. Only the business's own approvers can move it. This is enforced by code and checked by tests and CI (the `splash-never-holds-client-funds` job); see the invariants below.
**Licence:** Splash is not yet a licensed money-services business. Payout partners carry out the regulated payout; none is signed, and the partner in this build is a labelled mock.

The Sui build's mainnet cutover status, which this file used to hold, is kept in [`docs/prior-work/STATUS-sui-build.md`](docs/prior-work/STATUS-sui-build.md). The Sui build continues separately in `sky9484/phase1`.

---

## Phases (prompt 07)

Each phase is one PR into `sol/b0-solana-everywhere`. Sky or Sebastian merges; nothing is self-merged.

| Phase | What | PR | State |
|---|---|---|---|
| 0 | Sui removal inventory, route map | #1 | Open, for review |
| — | Devnet proof run 2 (CCTP V2 burn from a vault, attested) | #2 | Open, for review |
| 1 | Sign-in (email/password, Google), device key, recovery kit, vault setup | #3 | Open, for review |
| 2 | Evidence layer isolated (Seal + Walrus in `lib/evidence-sui/`), Sui settlement deleted | #4 | Open; **needs Sebastian: G1, G2** |
| 3 | The money path: durable state machine, controls, Kora cap, batch chunking, LiteSVM suite | #5 | Open, for review |
| 4 | Every screen on Solana: dashboard, Solscan trace, batch, landing, Invoices / Transfer / Treasury | #6 | Open, for review; **D-P4-4 needs Sebastian** |
| 5 | Staff console: orgs and vaults, payments, fee payer, evidence, refuse service, webhooks | #7 | Open, for review |
| 6 | /trust, README, STATUS, CHANGES | #8 | Open, for review |
| 6b | Transfer in five steps: the payout partner's questions, pay from the vaults or fund another way (Sky, 13 Oct) | this branch (`sol/b0-p7-transfer`) | In progress; **D-P6-1 needs Sebastian** |

When all are merged: one PR to the default branch with before/after screenshots, the full test output and the "Not verified yet" list (prompt 07 §10). Sky reads it before merge.

## Gates (Sebastian answers in writing, in the PR, before the related code merges)

| Gate | Question | State |
|---|---|---|
| **G1** | Seal allowlist package: approve the Move code, publish to Sui testnet, paste the package and policy ids | Waiting. The Move package is written and tested, not published; no Move package is changed or published without written confirmation. |
| **G2** | One Ed25519 device key for the Solana signer and the Seal identity? (D-P2-1) | Waiting. If no, a second evidence key ships, and the recovery kit holds both. |
| **G3** | Vault config: `configAuthority` none, threshold 1 by default / 2 with joint control, recovery member weight, rotation | Waiting. Built as 1-of-N with no config authority. |
| **G4** | Kora: version, config format, the program allowlist, the per-company cap | Waiting. Built against Kora's source: allowlist in `lib/solana/kora.ts` and `kora.toml`, a cap of 50 a day. |
| D-P3-2 | Fee: 0.10% per payout, US$2 minimum | Waiting; the landing and the approval card already use it. |
| D-P4-4 | Treasury as vault #1 of the company's own multisig (no yield, no ledger) | Waiting, against Amendment 01. |
| D-P6-1 | Funding from outside the vaults through Stripe and Airwallex (sandbox), named in the product before an agreement | Waiting. Built as labelled sandbox stand-ins, refused on devnet. |

## The invariants (each has a test)

| Invariant | Where it is held |
|---|---|
| **I-1** No Splash key is a vault member; `configAuthority` is null | `lib/solana/squads.ts`; the staff console reads it from the chain |
| **I-2** A payout goes only to the partner's deposit address; a move only to the company's other vault | `lib/solana/payout.ts`, `lib/solana-app/treasury-service.ts` |
| **I-3** The fee payer never sends SOL or tokens; it pays fees and account rent only | `lib/solana/kora.ts` (validated before Kora is asked) |
| **I-4** No execute without the device key's signature on every prepared transaction | `lib/solana-app/service.ts`, `batch-service.ts`, `treasury-service.ts` |
| **I-5** A memo carries only a Splash id (`splash:pay:v1:`, `splash:move:v1:`) | `lib/solana/payout.ts` |
| **I-6** The approval card renders deterministic fields only, never model text | `lib/solana-app/service.ts` |
| **I-7** Simulated is always labelled | every receipt, screen and the staff console |
| Refuse service | A suspended company gets no fee-payer signature from any code path (`lib/solana-app/runtime.ts`) |
| Integer money | No float on an amount: `tests/money-integers.test.mjs` |

## What runs where

- **Offline (default):** a chain simulator checks every signature, Squads threshold and sponsorship rule. The payout partner is the mock. Evidence is sealed with a stand-in key into a stand-in store. Every screen says "Simulated · devnet-ready".
- **Devnet:** the same code with `SPLASH_SOLANA_MODE=devnet`, a Solana RPC and a Kora endpoint. Not yet run from the build machine; see "Not verified yet" in the [README](README.md).

## Checks

`npm test` (1,145 tests, 2 skipped loudly), `npm run test:solana` (233), `npm run test:claims`, `npm run lint`, `tsc --noEmit`, and the browser walkthrough `tests/solana-ui.e2e.mjs`. Decisions are recorded in [`docs/solana-build/DECISIONS.md`](docs/solana-build/DECISIONS.md).
