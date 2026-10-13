# Funding audit: adding money to the company's own vault (v15.1 §4.3)

## 1. Header

| | |
|---|---|
| Date | 14 Oct 2026 |
| Commit | `3a72324753e29b950556aa4c409b19c7b7765998` (`git rev-parse HEAD`) |
| Branch | `sol/b0-p8-a-audit` (worktree `.claude/worktrees/p8`) |
| Run by | Claude Code (Opus 5.5), read-only |
| Skills | Loaded in this session: payments-treasury-expert, fintech-architect, agentic-finance-expert, solana-payments-engineer, fintech-security-compliance, qa-verification-engineer. Not loaded for this read-only phase: the UI and product skills (motion-web-designer, ai-fintech-founder, product-strategy-growth, and the design skills AGENTS.md lists); Phase 0 loads them. |
| Scope | Read only. No code, test, config or dependency was changed. No npm, no server, no RPC call, no transaction, no faucet, no key. The only file written is this one. Official docs were read with WebFetch (sources in section 5). |
| Working tree | Clean at the start. While the audit ran, the same session began Phase 0 in this worktree (uncommitted design-system files). They are not in this commit and the audit doesn't cover them: it describes commit `3a72324` only. |
| Prior work | Commit `4768824` is the imported Sui build. Code that exists only there is not counted as built for Solana. Each BUILT item below names the commit that introduced it (`git log -S`). |

Docs read: `README.md`, `STATUS.md`, `docs/solana-build/SPEC.md`, `docs/prompts/SOLANA_BUILD_PROMPT.md`, `docs/prompts/FUNDING_AUDIT_PROMPT.md`, `docs/prior-work/PRIOR_WORK.md`, `docs/solana-build/DECISIONS.md` (D-7, D-P6-1), `docs/solana-build/SUI-REMOVAL.md` (D-7 rows). Route handlers were checked against the Next 16 docs in `node_modules/next/dist/docs/` (`params` is a Promise; the funding routes use it correctly). No handler is judged broken.

## 2. Verdict

1. **Offline: yes, simulated only.** "Add 25,000 test USDC" and "Add 100,000 test USDC" write to the simulator's in-memory ledger (`lib/solana-app/service.ts:446`, `lib/solana-app/treasury-service.ts:86`). The Transfer step 3 stand-ins (another wallet, swap, Stripe, Airwallex) also credit through the simulator, after a 2.5 s stub check.
2. **Devnet: only by hand. Mainnet: no.** On devnet the app shows the vault address and its USDC account and tells the person to send test USDC (`service.ts:440-445`, `components/solana/FundPanel.tsx:106-124`). It then reads the on-chain balance at `confirmed` (`lib/solana/simulator.ts:647-656`) and records nothing about the deposit. The one devnet funding on record (10 Oct, `docs/solana-build/devnet-run.json`) was done by `scripts/solana-devnet-e2e.ts`, not by the app. Mainnet is refused at config (`lib/solana/config.ts:148-150`).
3. **Biggest gap: there is no deposit pipeline.** Nothing detects, records, mint-checks, screens or holds a deposit, so any USDC that reaches the vault counts at once as "Available to pay suppliers", unscreened (F3). No inbound CCTP or Jupiter code exists either.

## 3. CRITICAL findings

**CRIT-1 · Wrong destination in a live legacy API (F1).** `POST /api/funding/sessions` with `rail: 'CCTP'` returns a deposit address that is not the company's vault, and `QRCode.toDataURL` renders it as a QR code (`app/api/funding/sessions/route.ts:68-75`):
- In any non-production run, the address is `0x` plus the first 40 hex characters of a sha256 hash, so no one holds a key for it (`lib/server/funding-sessions.ts:89-90`). Real USDC sent there on Ethereum, Base or Arbitrum is lost.
- In production it is an address from `FUNDING_CCTP_DEPOSIT_ADDRESSES_JSON` (`funding-sessions.ts:80-86`): a source-chain address Splash configures, never the vault.
- Who can reach it: any signed-in customer (`requireCustomerRequest`), because the default `LAUNCH_SCOPE` is `full` (`lib/launch-scope-rules.ts:33-35`).
- No page calls it. Its only caller, `components/transfer/StepQuote.tsx:240`, belongs to the retired wizard and is imported nowhere.
- Origin: `4768824` (prior work), ported in `2a8b895`.
- Fix: return 410 from, or delete, `app/api/funding/sessions/**`, `app/api/funding/deposits`, `app/api/funding/usd-deposits` and `app/api/funding/options` (build plan step 1).

**CRIT-2 · Private-key literal in a test.** `tests/evidence-sui.test.mjs:74` holds a Sui-format private key. The comment calls it a throwaway test key; it was introduced in `08609f9`. It is not a funding or Solana key, and I did not check whether it holds funds (UNVERIFIED). Replace it with a key generated at test time and never fund it.

**CRIT-3 · The canon's USDT mint is not Tether's (a spec error, not in code).**
- The v15.1 rule F2 (and this audit's brief) gives mainnet USDT as `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY4m2Lzd5k5Pz8Wq`.
- Tether's own page (https://tether.to/en/supported-protocols/, read 14 Oct 2026) lists the Solana USD₮ contract address as `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`, and says the canon string does not appear on the page.
- No code pins either value today.
- If Phase 3 copies the canon string, every real USDT deposit fails the mint check, or a lookalike gets allowlisted. Pin Tether's value and correct the canon.

**Checked, nothing critical found:**
- Splash authority over client tokens. No `approve`, `delegate` or `setAuthority` instruction is built anywhere in `lib/solana*`, `lib/route-engine`, `app/api/solana`, `components/solana` or `scripts/solana-devnet-e2e.ts` (the grep is empty). The Kora check refuses the fee payer in any SPL Token or CCTP instruction (`lib/solana/kora.ts:297-299`, `310-313`), and `kora.toml:30` turns off `transfer_transaction`.
- Missing mint check. On devnet the balance is read only from the token account of the pinned USDC mint, under the classic Token program (`lib/solana/payout.ts:99-101`, `simulator.ts:647-656`). A lookalike or Token-2022 token can't be counted. It is also never flagged (see A6).
- Wrong destination on the Solana screens. The vault PDA is index 0 of the company's multisig, derived on the server at setup (`lib/solana/squads.ts:112-125`, `lib/solana-app/account-setup.ts:112-124`). The screen shows that PDA and its USDC account (`service.ts:495`).
- Secrets.
  - Grep patterns: `sk_live`/`sk_test`, PEM private keys, AWS keys, Anthropic/OpenAI/GitHub tokens, 64-integer keypair arrays, base58 strings of 86-88 characters, `secretKey`, `PRIVATE_KEY`, `mnemonic`, seed phrases.
  - Hits: the base58 hits are transaction signatures in `devnet-run.json:39-58`, not keys. The BIP39 vectors in `tests/solana-chain-recovery.test.mjs:62` are published test vectors.
  - Dev-only credentials, recorded but not critical: the admin console's built-in demo login (`lib/server/admin-auth.ts:14-15`) is refused in production (`admin-auth.ts:204-214`); the local dev database seeds a demo password (`scripts/dev-db.mjs:169`).

**Also found (high, not critical):**
- **Legacy deposit webhook takes unauthenticated posts outside production.** `assertFundingWebhookSecret` returns early when `FUNDING_WEBHOOK_SECRET` is unset and `NODE_ENV` is not production (`lib/server/funding-intake.ts:33`). `ingestStablecoinDeposit` then trusts the mint, amount and risk score in the request body without reading the chain, and credits the legacy Splash ledger (`funding-intake.ts:63-121`, `recordMovement` at `106-113`). That ledger is not the Solana vault balance.
- **Legacy session read has no org check.** `GET /api/funding/sessions/[id]` returns any session by id (`app/api/funding/sessions/[id]/route.ts:18`). `POST` (simulate a deposit) has no org check either (`:36`, `:47`).
- **The simulated funds check can credit twice.**
  - `refreshFunding` credits the simulator (`lib/solana-app/funding-service.ts:275`) before it sets `state = 'in_vault'` (`:276`). The client polls every 700 ms with overlapping requests (`components/solana/transfer/TransferFlow.tsx:177-189`).
  - So two overlapping reads can both pass the `checking` check (`funding-service.ts:265`) and mint twice. The comment "Reading it twice never credits twice" (`:259`) holds only for sequential reads.
  - Simulated only, but a real adapter must not copy the shape.
- **Float maths in legacy funding code.** `Math.round(amountUsd * 1_000_000)` (`app/api/funding/sessions/route.ts:54`) and `amountMicro / 1_000_000` (`funding-intake.ts:78`).

## 4. Status table

Statuses: BUILT (real code on the devnet path, with evidence), PARTIAL, SIMULATED-ONLY (reached only through the simulator), MISSING. "Devnet-unproven" means the code is mode-agnostic but has not run from the app on devnet. Paths in the Evidence column drop their leading `lib/` (so `solana/config.ts` is `lib/solana/config.ts`), except under `app/`, `components/`, `scripts/` and `tests/`.

### Canon rules

| Item | Status | Evidence (file:line) | Commit | Test | Gap | Effort | Risk if shipped |
|---|---|---|---|---|---|---|---|
| F1 Destination is the vault PDA's token account (index 0) | PARTIAL | PDA: `solana/squads.ts:112-125` (index 0 at `:119`), derived on the server at setup (`solana-app/account-setup.ts:112-124`). Shown: `solana-app/service.ts:495`, `components/solana/FundPanel.tsx:67-85`. Simulator credits the ATA: `solana/simulator.ts:321-329`. Devnet tells the person to send to the PDA: `service.ts:440-445` | `b928ea4`, `5ea6677` | `tests/solana-chain-simulator.test.mjs:134` (only the vault and partner hold USDC); `tests/solana-treasury-transfer.test.mjs:130` | ATA not created before a deposit (A3). The legacy CCTP route sends elsewhere (CRIT-1). No test pins the displayed address to the vault's ATA | S | Low on the Solana screens; high through the legacy API |
| F2 Allowlist by mint, pinned per cluster | PARTIAL | USDC pinned: `solana/config.ts:66-85`. Mainnet refused: `:148-150`. Balance reads only the pinned-mint ATA: `simulator.ts:647-656`, `solana/payout.ts:99-101`. Legacy explicit compare: `server/funding-intake.ts:49-52` (on webhook data) | `b928ea4`; legacy `2a8b895` | `tests/solana-chain-config.test.mjs:9`, `tests/funding-registry.test.mjs:22` | No USDT mint (and the canon's is wrong, CRIT-3). Lookalikes and Token-2022 are ignored silently, never flagged | S | Medium: a lookalike sent by mistake is never surfaced |
| F3 Source and destination screened before a deposit is usable; fail closed | MISSING (direct deposits); SIMULATED-ONLY (step 3) | Step 3 runs a deterministic stub (`route-engine/policy.ts:54-67`) via `solana-app/funding-service.ts:228-230`; flagged → `held` (`:266-270`). Payout policy screens only the payout address: `policy.ts:106-107` | `b928ea4`, `4b3119d` | `tests/solana-transfer-funding.test.mjs:133` | No screening of the sender or vault on any devnet path. The stub cannot fail, so there is no fail-closed path. Results are not in evidence. Sender address is typed in, not read from chain | M (adapter) + S (hold logic) | High: unscreened funds pay suppliers |
| F4 Splash fee 0 on funding; network cost at cost and shown | PARTIAL | Fee leg built only in `buildRoutePlan`: `service.ts:1089`, `:1101`, `:1119`. Moves carry no fee: `solana-app/treasury-service.ts:105-119`. Step 3 charges are provider estimates, integer, labelled sandbox: `funding-service.ts:35-38`, `:84-87` | `5ea6677`, `0af3a53`, `4b3119d` | `tests/solana-treasury-transfer.test.mjs:155` (no fee on a move); `tests/solana-transfer-funding.test.mjs:176` | Network costs are not shown as a figure. Kora pays for moves; the sender's fee on a deposit is not shown | S | Low |
| F5 Business signs; Splash relays only; no approve or delegate | BUILT | No approve/delegate/setAuthority code (empty grep). Kora rules: `solana/kora.ts:294-299`, `:310-313`. `kora.toml:30`. Device signature required: moves `treasury-service.ts:265-280`, payments `service.ts:1350-1365` | `b928ea4`, `5ea6677`, `0af3a53` | `tests/solana-chain-simulator.test.mjs:150`, `tests/solana-app-flow.test.mjs:170`, `tests/solana-treasury-transfer.test.mjs:171` | Not run against a live Kora (G4) | n/a | Low |
| F6 Claims and labels | PARTIAL | Banner: `components/dashboard/DashboardShell.tsx:368` ("Simulated · devnet-ready.") / `:370` ("Solana devnet · Mock partner."). Balance pill: `components/solana/BalanceHeader.tsx:20` | `07ea9a7`, `5ea6677` | `tests/claims.test.mjs` (banned words; partner names PDAX and Coins.ph only) | Funding UI names Stripe and Airwallex and claims "Stripe takes the USD and delivers USDC to your payments vault" (`funding-service.ts:61`, `:71`; shown at `components/solana/transfer/FundingChoice.tsx:106`) with no agreement (D-P6-1 open). "Screened before the money counts" (`FundingChoice.tsx:264`) while screening is a stub. Claims test does not guard provider names | S | Medium (claims) |

### Source A · USDC or USDT already on Solana

| Item | Status | Evidence (file:line) | Commit | Test | Gap | Effort | Risk if shipped |
|---|---|---|---|---|---|---|---|
| A1 Deposit screen: address, QR, network label, allowlist warning | PARTIAL | `components/solana/FundPanel.tsx:64-125`: PDA with Copy, USDC account, devnet steps (`:107-123`). Legacy QR exists only in `app/api/funding/sessions/route.ts:68-75` (Solana Pay URI `server/funding-sessions.ts:112-124`) | `5ea6677` | `tests/solana-ui.e2e.mjs:118-120` (screenshot of the Balance page; no assertion on QR or warning) | No QR, no "Solana network" label (only "choose Solana Devnet" at `:114`), no "send only USDC on Solana" warning | S | Medium: wrong token or chain sent to the PDA |
| A2 Address is the vault PDA; ATA derived per allowlisted mint | BUILT (USDC) | `service.ts:495` (ATA of cluster USDC mint for the PDA), `solana/payout.ts:99-101`, `solana/squads.ts:123-125` | `5ea6677`, `b928ea4` | None asserts the displayed ATA directly | No USDT ATA. Copy copies the PDA (owner); whether wallets and the Circle faucet accept an off-curve owner is UNVERIFIED (the e2e script warns of this at `scripts/solana-devnet-e2e.ts:297`) | S | Low to medium |
| A3 ATA created when missing (idempotent); who pays rent | PARTIAL | `CreateIdempotent`: `payout.ts:103-116`. Used for a move's destination vault, Kora pays rent: `treasury-service.ts:116-117`. e2e script: `scripts/solana-devnet-e2e.ts:293`. Simulator creates it implicitly: `simulator.ts:324` | `b928ea4`, `0af3a53` | `tests/solana-chain-payout-cctp.test.mjs:47` (payout ATA create) | Not created at vault setup or before an address is shown; the sender or faucet pays rent. Circle says a Solana CCTP mint reverts if the token account does not exist (section 5) | S | Medium; blocks B |
| A4 Deposit detection and confirmation level | PARTIAL (balance read only) | `DevnetChain.getUsdcBalance`: `simulator.ts:647-656` at `confirmed` (`:578`), read on page load or "refresh the balance" (`FundPanel.tsx:116-122`). Invoice matcher is a stub: `server/usdc-invoice-payments.ts:64-71`. Only the e2e script polls: `scripts/solana-devnet-e2e.ts:299-313` | `b928ea4` | None for devnet | No `onAccountChange`, `getSignaturesForAddress` or webhook. Shows `confirmed`, never waits for `finalized` | M | High: no record of what arrived, from whom, when |
| A5 Crediting matched to the company, idempotent on signature, stored, shown | PARTIAL / SIMULATED-ONLY | Offline: `org.fundings` entries with simulated signatures (`service.ts:447`, `funding-service.ts:279`), shown at `FundPanel.tsx:127-143`. Devnet: balance is the chain balance (`service.ts:454`, `:500`), so no ledger and no double credit, but no record either | `5ea6677`, `4b3119d` | `tests/solana-app-flow.test.mjs:67`, `tests/solana-transfer-funding.test.mjs:157` | No per-deposit record keyed on signature. Concurrent `refreshFunding` can double-credit (section 3) | M | Medium |
| A6 Mint check on every deposit | PARTIAL (implicit) | Pinned-mint ATA read: `simulator.ts:647-656`. Legacy compare on webhook data: `funding-intake.ts:49-52` | `b928ea4`; legacy `2a8b895` | `tests/funding-registry.test.mjs:34` (legacy registry only) | No per-deposit inspection. Lookalike and Token-2022 transfers are not flagged or reported | S (with A4) | Low to medium |
| A7 Sender screening; what a hit does | SIMULATED-ONLY | `funding-service.ts:228-230` (stub), `:266-270` (held, never reaches the vault). Sender address typed by the person: `FundingChoice.tsx:261-262`, validated only as base58 at `funding-service.ts:202-213` | `4b3119d` | `tests/solana-transfer-funding.test.mjs:133` | No real KYT. A direct deposit is never screened. The sender is not proven (no signature or chain read) | M | High |
| A8 Connect wallet and send (wallet-standard, exact `transferChecked`, locked destination) | MISSING | No wallet-adapter or wallet-standard dependency in `package.json`; no code (grep) | n/a | n/a | Whole feature | M | n/a (absent) |
| A9 Funding event written (amount, mint, sender, signature, screening) | PARTIAL (simulated) | `PaymentFunding` record: `solana-app/store.ts:132-157` (amount, asset, sender, check id and label, simulated signature, declaration), kept in the company document, not in evidence. Payout evidence carries only the payout's KYT: `solana-evidence/bundle.ts:86` | `4b3119d` | `tests/solana-transfer-funding.test.mjs:106` | Direct deposits write nothing. No mint field. Not anchored | S to M | Medium (audit trail) |
| A10 Offline vs devnet vs mainnet, and the flag | BUILT | `SPLASH_SOLANA_MODE` read at `solana/config.ts:138-156`, mainnet refused `:148-150`. `createChain`: `simulator.ts:700-701`. Devnet answers: `service.ts:440-445`, `treasury-service.ts:83-85`, `funding-service.ts:216-222` | `b928ea4`, `5ea6677`, `4b3119d` | `tests/solana-chain-config.test.mjs:20`, `tests/solana-app-flow.test.mjs:304` | The test named "on devnet the sandbox providers are refused…" (`tests/solana-transfer-funding.test.mjs:184`) only checks offline, so the devnet refusal is untested. Legacy routes switch on `NODE_ENV`/`USE_MOCK_APIS`/`NEXT_PUBLIC_DEMO_MODE` instead | S | Low |

### Source B · USDC from another chain via CCTP V2

| Item | Status | Evidence (file:line) | Commit | Test | Gap | Effort | Risk if shipped |
|---|---|---|---|---|---|---|---|
| B1 Burn on a source chain with Solana as destination | MISSING | `solana/cctp-v2-solana.ts` is outbound only (allowed destinations `[7]` at `:34-35`). App refuses CCTP on devnet: `service.ts:1105-1107`. No EVM or Sui client dependency. Legacy registry lists Ethereum, Base, Arbitrum (`funding/registry.ts:93-101`) and hands out a non-vault address (CRIT-1) | n/a | n/a | Whole inbound lane | L | n/a; legacy route is CRIT-1 |
| B2 Domain IDs verified | PARTIAL | `solana/config.ts:43-46`: Solana 5 and Polygon 7, both match Circle. No inbound source domains in code | `b928ea4` | `tests/solana-chain-payout-cctp.test.mjs:131` (seed "7") | Add 0, 3, 6 (and 1 for Avalanche) from Circle. Sui 8 is listed, but V2 on Sui is not confirmed (section 5) | S | n/a |
| B3 `mintRecipient` = vault PDA's USDC token account, 32 bytes | MISSING | Outbound only encodes an EVM address: `cctp-v2-solana.ts:46-54`, `:127` | n/a | n/a | Must be the vault ATA (Circle: the token account, which must exist, see A3) | S (once B1 exists) | High if the PDA or multisig is used instead |
| B4 `destinationCaller` = 32 zero bytes | MISSING (inbound) | Outbound sets zero bytes: `cctp-v2-solana.ts:143` | `b928ea4` | `tests/solana-chain-payout-cctp.test.mjs:116` (outbound) | Inbound burn not built | S | n/a |
| B5 Iris attestation, `receiveMessage` on Solana: who submits, pays, retries; forwarding | MISSING | Only a URL builder: `cctp-v2-solana.ts:205-208`. e2e script polls Iris for its outbound burn: `scripts/solana-devnet-e2e.ts:353-378`. No `receiveMessage`. The Kora check refuses the fee payer inside CCTP instructions (`kora.ts:310-313`), so Kora as the `receiveMessage` payer would be refused as written | n/a | n/a | Relayer, Kora rule, retries. Circle lists Solana as a Forwarding Service destination (section 5); whether it serves a PDA-owned token account and what it costs is UNVERIFIED | M | n/a |
| B6 Fast vs Standard; fee at cost; Splash 0 | MISSING (inbound) | Outbound handles both: `cctp-v2-solana.ts:128-133` | `b928ea4` | `tests/solana-chain-payout-cctp.test.mjs:136` | Inbound fee quote and display | S | n/a |
| B7 Source-side UX: EVM or Sui wallet, exact approval to TokenMessenger only | MISSING | No code | n/a | n/a | Whole feature | M to L | n/a |
| B8 States (pending, attested, minted, failed, stuck), retry, no double mint | MISSING | No `cctp_messages` table or relay code (grep of `lib/`, `drizzle/`) | n/a | n/a | State machine unique on `(source_domain, nonce)` | M | n/a |
| B9 Source screening | MISSING | n/a | n/a | n/a | Screen the source address before treating a mint as usable | S (with F3 adapter) | n/a |

### Source C · SOL or USDT on Solana swapped to USDC with Jupiter

| Item | Status | Evidence (file:line) | Commit | Test | Gap | Effort | Risk if shipped |
|---|---|---|---|---|---|---|---|
| C1 Jupiter integrated; API version | MISSING | No Jupiter code or dependency (grep). The "swap" is a stand-in: `funding-service.ts:49-58` (fixed 20 bps estimate), refused on devnet `:216-217`, credited by the simulator `:275`. Legacy normalisation refuses non-USDC: `server/funding-normalization.ts:15-27` | n/a | n/a | Whole lane | L | n/a |
| C2 Where the swap runs | MISSING | n/a | n/a | n/a | Choose: the business's own wallet with output to the vault ATA (preferred) | n/a | n/a |
| C3 Quote shown before signing; re-quote loop | MISSING | n/a | n/a | n/a | In, out, min out, slippage, impact, route, expiry | M | n/a |
| C4 Slippage and impact caps in code | MISSING | Only a Sui-era guard: `funding/normalization-policy.ts:19-24` (`4768824`, prior work, not counted) | n/a | `tests/funding-policy.test.mjs:30` (legacy) | Caps for Solana | S | n/a |
| C5 Output mint pinned to USDC; destination locked | MISSING | n/a | n/a | n/a | Pin `usdcMint(cluster)`; destination = vault ATA | S | n/a |
| C6 Business signs; no delegate; Splash fee 0 | MISSING | n/a | n/a | n/a | No platform fee param; no approval to Splash | S | n/a |
| C7 Failures with nothing stranded | MISSING | n/a | n/a | n/a | Expired blockhash, failed swap, partial routes | M | n/a |

### 4b. Step 3 "fund it another way" and legacy funding code

| Code | Real or simulated | Evidence | Commit |
|---|---|---|---|
| `FUNDING_METHODS` `wallet_usdc`, `wallet_swap`, `stripe`, `airwallex` | Simulated only. Every method credits through `chain.fundUsdc`, which exists only on the simulator (`funding-service.ts:274-275`). On devnet, `startFunding` refuses the three sandbox methods and answers `wallet_usdc` with "send it yourself, then check again" (`:216-222`), with no follow-up detection | `funding-service.ts:38-79`, `:172-281` | `4b3119d` |
| `app/api/solana/payments/[id]/fund/route.ts` | Real route over the simulated service. `POST` runs `requireMoneyGates` (KYB, terms) first (`:25`) | `:9-31` | `4b3119d` |
| `app/api/solana/fundings/[id]/route.ts` | A `GET` with a side effect: it credits the vault in the simulator via `refreshFunding` (`:46`). See the race in section 3 | `:8-15` | `4b3119d` |
| `lib/server/stripe.ts`, `lib/server/airwallex.ts` | Scaffolds, imported nowhere. `confirmStripeDeposit` and `confirmAirwallexDeposit` always return `confirmed: true` (`stripe.ts:70-72`, `airwallex.ts:35-38`). Dangerous if ever wired | whole files | `4768824` (prior work only) |
| `lib/funding/registry.ts`, `kyt-policy.ts`, `normalization-policy.ts`; `lib/server/funding-sessions.ts`, `funding-intake.ts`, `funding-normalization.ts`; `app/api/funding/**` | Sui-era. Reworded for Solana in `2a8b895`: USDC only, the vault as the Solana-rail address, a Solana Pay URI. Live as API routes, but only the retired wizard calls them (`components/transfer/StepQuote.tsx`, imported nowhere). In-memory sessions. Deposits arrive by webhook and are not read from chain. Credits go to the legacy Splash ledger, not the vault. Contains CRIT-1 | see section 3 | `4768824`, `2a8b895` |
| `lib/server/wallet-screening.ts` | A real Chainalysis sanctions adapter for recipients. Fail-closed on `ERROR` (`:84-96`). Not wired to funding; reusable for F3 | `:34-67` | `4768824` (prior work) |

### 4c. Cross-cutting checks

- **Recovery kit and device key stay in the browser.**
  - Setup routes accept only `{role, publicKey}` and `{role, publicKey, nonce, signature}`, under strict schemas (`app/api/setup/challenge/route.ts:12`, `app/api/setup/complete/route.ts:15`).
  - The device key is generated non-extractable, and refused if extractable (`lib/solana/device-key.ts:109-110`).
  - The recovery kit is imported only by `components/setup/DeviceSetup.tsx:8` on the client; the server imports only the possession-challenge helpers. Commits `c72dcd3` (setup routes) and `b928ea4` (device key).
- **The server never signs for the business.** It builds unsigned messages. Execute without every device signature returns 403 (`service.ts:1352`, `:1365`; moves `treasury-service.ts:267`, `:280`). Tests: `tests/solana-app-flow.test.mjs:180-184`, `tests/solana-treasury-transfer.test.mjs:187`.
- **What Kora pays for in funding paths.**
  - Direct deposits: nothing.
  - Offline faucet: nothing (no transaction is built).
  - Moves: the fee and the destination vault's ATA rent (`treasury-service.ts:116-117`).
  - Allowlist: `kora.toml:67-77`, which has no Jupiter. `allowed_tokens` is devnet USDC only (`:79`).
  - Kora cannot move client tokens (`kora.ts:294-299`).
- **Integer base units.** The Solana funding code uses `bigint` throughout (`funding-service.ts:84-87`; `OFFLINE_FUND_MINOR` at `service.ts:96`). Floats appear only in legacy code (section 3).

### 4d. Tests that touch funding

- **Offline faucet, then pay:** `tests/solana-app-flow.test.mjs`, `tests/solana-company.test.mjs`, `tests/solana-money-path.test.mjs`, `tests/solana-batch*.test.mjs`, `tests/solana-admin.test.mjs`.
- **Step 3:** `tests/solana-transfer-funding.test.mjs`.
- **Treasury moves:** `tests/solana-treasury-transfer.test.mjs`.
- **Simulator invariants:** `tests/solana-chain-simulator.test.mjs`.
- **Mint config:** `tests/solana-chain-config.test.mjs`.
- **Legacy registry and KYT policy:** `tests/funding-registry.test.mjs`, `tests/funding-policy.test.mjs` (not in `test:solana`).
- **UI walkthrough:** `tests/solana-ui.e2e.mjs`.
- **No tests at all for:** devnet deposit detection, a lookalike or Token-2022 deposit, the deposit QR or warning, the vault ATA create before a deposit, any CCTP inbound or Jupiter item, the devnet refusal in step 3, or concurrent `refreshFunding`.

## 5. Verified constants

| Constant | In code | Official source (read 14 Oct 2026) | Matches |
|---|---|---|---|
| USDC mint, mainnet | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (`solana/config.ts:79`) | https://developers.circle.com/stablecoins/usdc-contract-addresses, "Mainnet" table, row "Solana" | Yes |
| USDC mint, devnet | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (`config.ts:70`, `kora.toml:79`) | Same page, "Testnet" table, row "Solana Devnet" | Yes |
| USDT mint, mainnet | Not in code | https://tether.to/en/supported-protocols/, "Solana Token via Solana Blockchain", "USD₮ contract address: Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" | Canon value `…NkY4m2Lzd5k5Pz8Wq` does **not** match (CRIT-3) |
| CCTP MessageTransmitterV2 | `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC` (`config.ts:35`) | https://developers.circle.com/cctp/references/solana-programs (same on mainnet and devnet) | Yes |
| CCTP TokenMessengerMinterV2 | `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe` (`config.ts:37`) | Same page | Yes |
| CCTP domain, Solana | 5 (`config.ts:44`) | https://developers.circle.com/cctp/concepts/supported-chains-and-domains | Yes |
| CCTP domain, Polygon PoS | 7 (`config.ts:45`) | Same page | Yes |
| CCTP domains, Ethereum 0, Avalanche 1, Arbitrum 3, Base 6, Sui 8 | Not in Solana code | Same page lists exactly these | n/a (none in code) |
| CCTP V2 on Sui | n/a | Supported-chains table: Sui (8) is a Standard source; Fast "N/A", upfront fees ❌, Forwarding ❌, with no version label. The page's agent-instructions block says "Noble, Sui, and Aptos still require V1". The migration guide (https://developers.circle.com/cctp/migration-from-v1-to-v2) says "CCTP V2 contracts are available on all CCTP V1 chains except for Noble and Sui" and "Sui will be supported by V2 before the deprecation begins"; V1 deprecation runs 31 Oct to 1 Dec 2026. Release note 2026.10.08 (https://developers.circle.com/release-notes/cctp-2026): "Added Sui mainnet and testnet as supported blockchains for CCTP (domain 8)", with no version | **UNVERIFIED**: V2 on Sui not confirmed by Circle |
| Fast Transfer as source | Outbound only: `CCTP_FINALITY` fast 1000, standard 2000 (`config.ts:49-52`) | Supported-chains page: Fast ✅ for Ethereum, Arbitrum, Base, Solana; "N/A" (already fast) for Polygon PoS, Avalanche, Sui | Domains match; threshold values not re-checked this session (UNVERIFIED) |
| Forwarding Service into Solana | Not used | Supported-chains page: Solana ✅ in the "Forwarding Service" column, which the page defines as availability as a destination | Supported per the page. Fit for a PDA-owned token account and its fee are UNVERIFIED |
| `mintRecipient` on Solana | n/a | Solana programs page: the recipient is the USDC token account, and it "must exist when `receiveMessage` is called on Solana, or the instruction reverts" | Informs A3 and B3 |
| Iris endpoint | `https://iris-api-sandbox.circle.com/v2/messages/5?transactionHash=…` (`cctp-v2-solana.ts:205-208`) | Circle API reference "Get messages and attestations" (https://developers.circle.com/api-reference/cctp/all/get-messages-v2): `/v2/messages/{sourceDomainId}` with `transactionHash` | Sandbox host and path match; mainnet host `iris-api.circle.com` UNVERIFIED this session |
| Squads V4 | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` (`config.ts:23`) | Matches `PROGRAM_ID` in `node_modules/@sqds/multisig` 2.1.4 (Squads' own package). No Squads web page confirmed it this session | Package match; web source UNVERIFIED |
| SPL Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` (`config.ts:25`) | https://www.solana-program.com/docs/memo (the program in the log examples) | Yes |
| SPL Token, ATA | `TokenkegQ…VQ5DA`, `ATokenGP…A8knL` (`config.ts:27`, `:29`) | `node_modules/@solana/spl-token/lib/cjs/constants.js` (Solana's package) | Package match |
| SAS | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` (`config.ts:39`) | Present in `node_modules/sas-lib` 1.0.10 generated code; no web page found | Package match; web source UNVERIFIED |
| Circle faucet | `https://faucet.circle.com/` (`service.ts:97`) | Not re-checked | UNVERIFIED |

No program ID or domain was checked on-chain (no RPC calls were made).

## 6. Test run

Run at commit `3a72324` (Node 24.15.0, dependencies installed with `npm ci` under npm 11.6.2), 14 Oct 2026:

| Command | Result |
|---|---|
| `npm run test:solana` | 234 tests: 232 pass, 0 fail, 2 skipped: the two LiteSVM tests, because LiteSVM's native binding is published for macOS and Linux only and this run was on Windows. 25.8 s. |
| `npx tsc --noEmit -p tsconfig.json` | 0 errors (exit 0). |

Failing tests: none. Which funding items have tests: section 4d.

## 7. Adapter decision for Phase 3

| Funding source | Phase 3 | Why |
|---|---|---|
| Payments account balance (pay from vault #0) | Real adapter | BUILT: `DevnetChain.getUsdcBalance` reads the pinned-mint ATA on chain (`simulator.ts:647-656`), the same code path in both modes. Devnet-unproven from the app |
| Reserve move (treasury vault #1 → payments vault #0) | Real adapter | BUILT: `treasury-service.ts:105-320`. `transferChecked` between the company's own vaults, Kora pays rent, device signature required, no fee; tests in `tests/solana-treasury-transfer.test.mjs`. Devnet-unproven |
| USDC on Solana from the company's own wallet | Mock (the deposit event) | PARTIAL: an address is shown and a balance is read, but there is no detection, record, mint flag, screening, ATA create or wallet connect. Keep the real balance read; mock the deposit event |
| USDT on Solana | Mock | MISSING: no mint in code, the canon value is wrong (CRIT-3), and no payout partner accepts it yet |
| CCTP from Ethereum, Base, Arbitrum, Polygon, Avalanche | Mock | MISSING: outbound only, no source-chain burn, no Iris or `receiveMessage`. Legacy route is CRIT-1 |
| CCTP from Sui | Mock | MISSING, and Circle does not confirm V2 on Sui (section 5). V1 is being deprecated 31 Oct to 1 Dec 2026 |
| Swap of SOL or other tokens via Jupiter | Mock | MISSING: no Jupiter code. The "swap" is a simulator stand-in with a fixed 20 bps estimate |
| Bank or card top-up (Stripe, Airwallex) | Mock | SIMULATED-ONLY or scaffold: the stand-ins credit the simulator; the server scaffolds always say "confirmed". No agreement signed (D-P6-1) |

## 8. Build plan for the gaps (not implemented)

Order: destination and mint, then detection and crediting, then CCTP inbound, then Jupiter. (a) marks what an honestly labelled Colosseum demo needs; (b) marks what a first real devnet funding run needs.

**1. Destination and mint (a, b)**
1. **Retire the legacy funding routes (CRIT-1).**
   - Files: `app/api/funding/{sessions,sessions/[id],deposits,usd-deposits,options}/route.ts` (return 410, or delete with `lib/server/funding-{sessions,intake}.ts`).
   - Test: a route test that each returns 410 and that no response contains a `0x` deposit address.
   - Acceptance: a grep finds no `readConfiguredCctpAddress`.
   - Effort: S.
2. **Create the vault's USDC ATA before showing an address.**
   - Files: `lib/solana-app/account-setup.ts` (or a "prepare deposit" call in `service.ts`), using `buildCreateAtaIdempotentInstruction(feePayer, vaultPda, usdcMint)`, sent sponsored.
   - Test: after setup, the simulator has the ATA; re-running is a no-op; the Kora check accepts it.
   - Acceptance: the Balance page shows "USDC account ready".
   - Effort: S.
3. **Deposit screen.**
   - File: `components/solana/FundPanel.tsx`.
   - Add: a QR of a Solana Pay URI (`solana:<vaultPda>?spl-token=<usdcMint>`); the label "Solana network"; the warning "Send only USDC on Solana. Other tokens or networks can be lost."; the mint shown in short.
   - Tests: e2e asserts the label, warning and QR; a unit test asserts the URI's `spl-token` equals `usdcMint(cluster)`.
   - Effort: S.
4. **A pinned token allowlist.**
   - File: `lib/solana/config.ts`.
   - Shape: `ALLOWED_DEPOSIT_MINTS[cluster] = [{ symbol, mint, program: 'token', enabled }]`; USDT uses Tether's `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`, disabled until a partner accepts it.
   - Test: `tests/solana-chain-config.test.mjs` pins both values and asserts that USDT is off.
   - Effort: S.
5. **Copy and claims.**
   - Remove or label the Stripe and Airwallex capability claims (`funding-service.ts:61`, `:71`).
   - Change "Screened before the money counts" to say the check is a stub (`FundingChoice.tsx:264`).
   - Add Stripe and Airwallex to the claims guard until D-P6-1 is answered.
   - Effort: S.

**2. Detection and crediting (b)**

6. **Deposit watcher.**
   - File: new `lib/solana-app/deposit-watch.ts`.
   - Method: `getSignaturesForAddress(vaultAta, { until: lastSeen })`, then `getParsedTransaction` at `finalized`. Keep only `transferChecked` or `transfer` into the vault ATA whose mint is allowlisted. Any other mint, or a Token-2022 account owned by the vault, is flagged and never counted.
   - Triggers: polling from the Balance page and a cron route (`app/api/solana/cron/deposits/route.ts`).
   - Tests: a fixture with a USDC deposit, a lookalike mint, a Token-2022 transfer and a replayed signature.
   - Effort: M.
7. **Deposit records.**
   - Table: `sol_deposits` (Drizzle), unique on `(signature, ix_index)`, with `org_id`, `mint`, `amount_minor`, `sender`, `slot`, `commitment`, `screen_result`, `state` (`seen`, `held`, `usable`).
   - Writes: compare-and-set, the same pattern as `payment-repo.ts`.
   - Tests: a retry or reorg (`confirmed` seen, then dropped) never double-counts.
   - Effort: M.
8. **Screening adapter.**
   - File: new `lib/solana-screening/threat-signals.ts`, reusing `lib/server/wallet-screening.ts` (Chainalysis sanctions) or the chosen KYT vendor.
   - Rules: provider timeout → `unknown` → held above a threshold; a hit → `held`, never usable.
   - Usable balance: total minus held deposits. Payout policy reads it instead of the raw balance.
   - Results go into a funding evidence record (see question 3).
   - Tests: a hit, a timeout and the stub label.
   - Effort: M.
9. **Fix the simulated double credit.**
   - Claim `state = 'crediting'` before the await in `refreshFunding`.
   - Test: two concurrent calls credit once.
   - Effort: S.
10. **Optional: connect wallet and send (A8).**
    - Use the wallet-standard adapter; build `transferChecked` client-side with the destination fixed to the vault ATA and the amount exact; the business's wallet signs.
    - Test: the destination can't be edited and the mint is pinned.
    - Effort: M.

**3. CCTP inbound (b, after Sky decides the chains)**

11. **Source-chain burn.**
    - Files: `lib/cctp-inbound/evm.ts` with viem: `approve` the exact amount to TokenMessengerV2 only, then `depositForBurn` with destination domain 5.
    - `mintRecipient` = the vault ATA as 32 bytes; `destinationCaller` = zero bytes.
    - Domains 0, 3, 6 (and 1, 7) pinned from Circle.
    - Tests: encoding vectors, mint recipient ≠ PDA or multisig, exact approval.
    - Effort: L.
12. **Attestation and mint on Solana.**
    - Iris poll, then `receiveMessage` (state table unique on `(source_domain, nonce)`), or Circle's Forwarding Service.
    - Decide who pays. Today `kora.ts:310-313` refuses the fee payer in CCTP instructions, so a separate relayer key, or a narrow Kora rule for the `receiveMessage` payer slot, is needed.
    - Tests: pending, attested, minted, stuck → retry, no double mint.
    - Effort: M.
13. **Sui.** Only after Circle confirms V2 on Sui; otherwise mock. Effort: L.

**4. Jupiter (last)**

14. **Swap into the vault.**
    - Use Jupiter's current Swap API (version UNVERIFIED this session). The swap runs in the business's own wallet, with output to the vault USDC ATA (destination token account) and the output mint pinned.
    - Show in, out, min out, slippage, impact, route and expiry. Re-quote on expiry or a min-out move of more than 5 bps.
    - Caps enforced in code. No platform fee param.
    - Tests: caps, the pinned mint and destination, an expired quote.
    - Effort: L.

## 9. Open business questions for Sky

1. **KYT vendor and threshold.** Which vendor (pay-per-check), and what is the hold rule: a held deposit never becomes usable, or it is usable below an amount when the provider is unreachable?
2. **USDT before a partner accepts it.** Should the vault show a USDT address at all? Today nothing could pay it out, and D-7 says only USDC reaches the vault. Also confirm the corrected mint (CRIT-3).
3. **Funding evidence.** Do deposits and moves get their own evidence record (amount, mint, sender, signature, screening) and anchor, or only a line in the payment's bundle when they fund it?
4. **Unsolicited deposits.** A self-custodial vault can't refuse a deposit. If a flagged or lookalike deposit arrives, who handles it, and is returning it a vault proposal the business signs?
5. **Rent for the vault ATA.** Splash, through Kora at setup (about 0.002 SOL per company), or the first sender?
6. **The legacy funding routes.** Delete them now (recommended), or keep them behind a flag?
7. **Stripe and Airwallex.** Until D-P6-1 is answered, may their names appear in the funding UI at all, given the claims rules?
8. **CCTP sources.** Which chains first (Ethereum, Base, Arbitrum)? Is Circle's Forwarding Service acceptable as the payer of the Solana mint? And should Sui wait for Circle's V2 there?
9. **Confirmation level.** Is a deposit usable at `confirmed` or only at `finalized`? The skill guidance is: show `confirmed`, settle on `finalized`.
