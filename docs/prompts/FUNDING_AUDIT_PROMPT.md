# Prompt: audit stablecoin funding into the business vault (splash-solana, Business Module v15.1)

**For:** Sebastian, in a Claude Code session on `sky9484/splash-solana`.
**Written:** 12 Oct 2026 by Sky's request. **Canon:** Business Module v15.1 (§4.3 Fund, §4.5, §4.6) + Amendment 01 (12 Oct, pricing). Both are in the Splash project docs; the rules you need are copied below.
**Mode: AUDIT ONLY.** Do not change application code. The only file you write is the report. Then a build plan.

---

## Paste everything below this line into Claude Code

You are auditing the `splash-solana` repository. Your job is to answer one question with evidence:

> **Can a business fund its own Splash vault on Solana with stablecoins today, and which parts of the Business Module v15.1 funding flow are BUILT, PARTIAL, SIMULATED-ONLY or MISSING?**

You must not edit application code, tests, config or dependencies. You write one file, `docs/solana-build/FUNDING-AUDIT.md`, and commit it on branch `build/solana-colosseum`. **Never commit to, merge into or push `main`.**

### 0. Before you start
1. `git checkout build/solana-colosseum && git pull`. Record `git rev-parse HEAD` in the report.
2. Read `AGENTS.md` and `CLAUDE.md`. Load the skills they require for this kind of work: `solana-payments-engineer`, `payments-treasury-expert`, `fintech-architect`, `fintech-security-compliance`. If a skill is missing in your session, say so in the report and carry on.
3. This repo uses a Next.js version with breaking changes. Read the relevant guide in `node_modules/next/dist/docs/` before judging any route handler or page as broken.
4. Read, in this order: `README.md`, `docs/solana-build/SPEC.md`, `docs/prompts/SOLANA_BUILD_PROMPT.md`, `docs/prior-work/PRIOR_WORK.md`, `STATUS.md`.
5. Note the first commit (`4768824`) is imported prior work from the Sui build. **Anything that exists only in prior-work Sui code does not count as built for Solana.** Say which commit introduced each piece you mark BUILT.

### 1. Where to start looking (not exhaustive; search the whole repo)
- `app/api/solana/fund/route.ts` → `fund()` in `lib/solana-app/service.ts`. Its comment says: offline mode credits 25,000 test USDC through the simulator; devnet answers with the vault address and a faucet link. Confirm what it actually does in each mode.
- `app/solana/fund/` (UI), `lib/solana/squads.ts`, `lib/solana/config.ts`, `lib/solana/simulator.ts`, `lib/solana/cctp-v2-solana.ts`, `lib/solana/kora.ts`, `lib/solana/types.ts`, `lib/solana-app/store.ts`, `lib/solana-zeke/router.ts`, `components/solana/*`.
- Search terms: `fund`, `deposit`, `ATA`, `getAssociatedTokenAddress`, `vaultPda`, `getVaultPda`, `mint`, `USDC`, `USDT`, `EPjFW`, `Es9vM`, `4zMMC9`, `jupiter`, `quote`, `slippage`, `priceImpact`, `cctp`, `depositForBurn`, `receiveMessage`, `mintRecipient`, `domain`, `screen`, `kyt`, `allowlist`, `webhook`, `onAccountChange`, `getTokenAccountBalance`, `QR`.

### 2. Canon rules the funding flow must meet (v15.1 §4.3, Solana build)
Engine settings for this build: `ENGINE_HOME_CHAIN=solana`, `ENGINE_LANES=solana`. Payouts go Solana-direct or CCTP V2 mint to Polygon; no Sui in the judged flow.

**F1 · Destination is always the business's own vault.** Funds land in the business's Squads V4 vault: the **vault PDA's** token account (vault index 0), **never** the multisig config account, never a Splash address, never a partner address. Check the code derives the vault PDA correctly and deposits to its associated token account. Check whether that token account is created when missing, and by whom (who pays the rent).

**F2 · Token allowlist by mint address, not by symbol.** Only native USDC and, where a payout partner accepts it, USDT (I7 as reworded on 4 Oct). Mints must be pinned per cluster in config: mainnet USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, mainnet USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY4m2Lzd5k5Pz8Wq`, devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. **Verify each address against Circle's and Tether's own documentation** and record the source. Lookalike tokens (same symbol, different mint, or a Token-2022 mint) must be rejected or flagged, not credited.

**F3 · Screening.** Both the source address and the destination are screened before Splash treats a deposit as usable (canon: "both addresses screened"; pay-per-check KYT now). Note that on-chain deposits to a self-custodial vault cannot be refused, so check what the code does with a flagged deposit: does it flag it, block payouts funded from it, or ignore it? The screening result must be written to the evidence record. Fail closed if the screening service is unreachable.

**F4 · Funding costs.** Splash's fee on funding is **0**. Route and network costs are passed through at cost and shown. No Splash fee leg may appear in any funding transaction. (The optional Splash fee leg in `lib/solana/payout.ts` is for payouts only; confirm it cannot run on a funding path.)

**F5 · Business signs, Splash relays only.** Splash never takes a standing approval, delegate or authority over the business's tokens. No `approve`/`delegate` to a Splash key. Splash's own keys may only pay fees (Kora) or relay a mint; they never hold or move client value.

**F6 · Claims and labels.** Every screen in offline or devnet mode shows "Simulated · devnet-ready" (or the devnet equivalent). No copy says "gasless", "instant", "free transfers", "licensed", a speed or finality number, or names a payout partner.

### 3. The three funding sources to audit (Sky's scope)

**Source A · USDC (or USDT) already on Solana, sent into the vault**
Check for each item: BUILT / PARTIAL / SIMULATED-ONLY / MISSING, with `file:line` evidence.
- A1. Deposit screen shows the vault deposit address and a QR code, labelled "Solana network" with a warning to send only allowlisted tokens on Solana.
- A2. The address shown is the vault PDA (owner of the token account), and the app derives the matching associated token account for each allowlisted mint.
- A3. Token account creation when missing (idempotent create), and who pays rent (Kora fee payer vs the sender).
- A4. Deposit detection: how the app learns a deposit arrived (polling `getTokenAccountBalance`, `onAccountChange`, `getSignaturesForAddress`, or a webhook provider). Confirmation level used (`confirmed` vs `finalized`) and why.
- A5. Crediting: the deposit is matched to the org, idempotent on transaction signature (no double credit on retry or reorg), stored in `lib/solana-app/store.ts` or the database, and shown in the balance.
- A6. Mint check (F2) on every detected deposit.
- A7. Screening of the sender address (F3) and what happens on a hit.
- A8. Optional "connect wallet and send": wallet-standard connection (e.g. Phantom, Solflare), an exact-amount `transferChecked` to the vault token account, signed by the business's external wallet. Destination locked to its own vault; the user cannot edit it.
- A9. Evidence: is a funding event (amount, mint, sender, signature, screening result) written anywhere? Canon only requires evidence for payments; record whether funding evidence exists.
- A10. Offline vs devnet vs mainnet behaviour, and the flag that switches them.

**Source B · USDC from another chain via CCTP V2 (Ethereum, Base, Arbitrum, Polygon, Sui) into the Solana vault**
- B1. Does any code burn on a source chain with Solana as the destination? (`lib/solana/cctp-v2-solana.ts` may handle outbound Solana → Polygon only; check direction.)
- B2. Domain IDs used, and **verified** against Circle's supported-chains page (expected Solana 5; confirm Ethereum, Base, Arbitrum, Polygon and Sui values from Circle, not from memory).
- B3. `mintRecipient` = the vault PDA's USDC token account, encoded as 32 bytes. Confirm it is the token account, not the vault PDA or the multisig.
- B4. `destinationCaller` = 32 zero bytes, so either Splash's relayer or a partner's relayer can complete the mint (canon from the Solana build prompt rev 2).
- B5. Attestation fetch from Circle's API (Iris) and the `receiveMessage` submission on Solana: who submits it, who pays the fee (Kora / Splash relayer), and retry handling. Check whether Circle offers a forwarding service into Solana; mark UNVERIFIED if you can't confirm from Circle's docs.
- B6. Fast vs Standard Transfer: Fast where the source supports it (Ethereum, Base, Arbitrum), Standard from Sui (Circle lists Fast as N/A for Sui). Fast fee shown and passed at cost; Splash fee 0.
- B7. Source-side UX: connect an EVM wallet (or Sui wallet), exact-amount USDC approval to Circle's TokenMessenger only (never unlimited, never to a Splash contract), burn signed by the business.
- B8. States and failures: pending attestation, attested, minted, failed, stuck; what the UI shows; how a stuck mint is retried; that nothing double-mints.
- B9. Screening of the source address (F3).

**Source C · SOL or USDT on Solana, swapped to USDC with Jupiter**
- C1. Is Jupiter integrated at all (quote and swap API, or SDK)? Which version/endpoint?
- C2. **Where the swap happens.** Preferred design: the swap runs in the business's external wallet with the output sent straight into the vault's USDC token account (Jupiter's destination token account option), so the vault only ever receives USDC. Alternative: the swap runs inside a Squads vault transaction, which needs address lookup tables and fits size limits poorly. Report which design the code uses, or none.
- C3. Quote shown before signing: input, expected USDC out, minimum out, slippage, price impact, route, quote expiry. Re-quote when the quote expires (canon re-quote loop: re-quote if it expires or min-out moves more than 5 bps before signing).
- C4. Slippage and price-impact caps enforced in code, not only shown.
- C5. Output mint is pinned to native USDC (F2); destination locked to the vault (F1).
- C6. The business signs; no delegate or approval to Splash (F5). Splash fee 0 (F4).
- C7. Failure handling: partial fills, expired blockhash, failed swap; no funds stranded in an intermediate account.

### 4. Cross-cutting checks
- **Secrets:** grep the repo, tests and fixtures for private keys, mnemonics, seed phrases, API keys, Kora signer keys. Any finding goes at the top of the report as CRITICAL (do not print the secret; give `file:line` only).
- **Key handling:** confirm the recovery kit and device key never leave the browser and are never logged, sent to an API or stored server-side.
- **Server never signs for the business:** the server builds unsigned transactions; execute without the business's signatures returns 403 (as the build commit claims). Confirm with a test or code path.
- **Kora:** what Kora pays for in the funding paths (rent, `receiveMessage`), its policy file (`lib/solana/kora.toml`) allowlist, and that it can't be used to move client tokens.
- **Amounts:** stablecoin amounts handled as integer base units (6 decimals for USDC/USDT), no floating-point maths; display rounding only at the edge.
- **Tests:** run `npm run test:solana` and the type check (`npx tsc --noEmit` or the repo's script). Record pass/fail counts. List which funding items have tests and which don't.
- **Devnet reality check (read-only):** if a devnet RPC URL is configured, you may run read-only calls (derive the vault PDA, read token balances) to confirm addresses. **Do not send transactions, do not request faucet funds, do not create accounts, and do not enter or generate any real keys.**

### 5. Report format (`docs/solana-build/FUNDING-AUDIT.md`)
1. **Header:** date, commit SHA, branch, who ran it, skills loaded or missing.
2. **Verdict in three lines:** can a business fund its vault today (offline / devnet / mainnet), and the single biggest gap.
3. **CRITICAL findings** (secrets, wrong destination, missing mint check, any Splash authority over client tokens). Empty section if none.
4. **Status table**, one row per item A1–A10, B1–B9, C1–C7 and F1–F6:

| ID | Requirement | Status (BUILT / PARTIAL / SIMULATED-ONLY / MISSING) | Evidence (`file:line`, commit) | Test? | Gap | Effort (S/M/L) | Risk if shipped as is |

5. **Verified constants:** every mint address, program ID and CCTP domain ID used, with the official source URL you checked, or UNVERIFIED.
6. **Test run:** command, pass/fail counts, failing test names.
7. **Build plan (do not implement):** ordered steps to close the gaps for (a) the Colosseum demo, honestly labelled, and (b) a first real devnet funding run. Each step: files to touch, tests to add, acceptance check, effort. Order by: correctness of destination and mint first, then detection and crediting, then CCTP inbound, then Jupiter.
8. **Open questions for Sky** (business decisions only, e.g. which KYT vendor, whether USDT is enabled before a partner accepts it, whether funding evidence should be anchored).

### 6. Rules
- Evidence or it didn't happen: every BUILT needs `file:line`. If code exists but is only called by the simulator, it's SIMULATED-ONLY.
- Don't trust comments, READMEs or commit messages; read the code path end to end.
- Mark anything you couldn't verify as UNVERIFIED. Don't guess program IDs or domain IDs.
- No code changes. If you find a bug, describe it and put the fix in the build plan.
- Commit only the report: `git add docs/solana-build/FUNDING-AUDIT.md && git commit -m "Funding audit (v15.1 §4.3): Solana deposit, CCTP V2 inbound, Jupiter"`, then push `build/solana-colosseum`. Never touch `main`.
- End your session with the verdict lines and the top five gaps.
