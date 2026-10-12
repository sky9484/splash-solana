# Sui removal inventory (prompt 07, Phase 0)

**Branch:** `sol/b0-p0-inventory` → `sol/b0-solana-everywhere` (cut from `build/solana-colosseum` @ `f604453`; the remote has no `main`).
**Written:** 12 Oct 2026. **Status:** inventory only, no code changed. Phase 1 waits for Sky's 👍 on §1.

This repo is the Solana build. Sui stays only as an invisible dependency of the evidence layer (Seal encryption + Walrus storage). The Sui build continues in `sky9484/phase1`; nothing here is a "migration off Sui".

## 0. How this was produced

```bash
P='\bsui\b|zklogin|enoki|@mysten|suiscan|suivision|\bSUI\b|move::|AdminCap|packageId|suiprivkey|PTB|USDsui|deepbook|memwal'
grep -rIinE "$P" app components lib scripts tests config content docs/*.md README.md proxy.ts instrumentation.ts | grep -v node_modules
```

- **1,926 matching lines in 263 files.** `proxy.ts` and `instrumentation.ts` have no hits.
- Every file was read (matching lines, imports, exports) and given exactly one action. For each DELETE, the files that import it were found by grepping `@/…` and relative paths, including dynamic `import()`.
- Root docs outside the grep's scope (`STATUS.md`, `HANDOVER.md`, `SECURITY.md`, `CHANGES.md`, `AGENTS.md`) and files that **don't match but import something being deleted** are listed separately in §4, so nothing breaks silently.

| Action | Meaning | Files |
|---|---|---|
| **DELETE** | Sui settlement, zkLogin, Move UI/config, peg/yield crons, DeepBook, USDsui, MemWal, USDY treasury, x402-on-Sui | 88 |
| **PORT** | The feature survives with a Solana implementation | 95 |
| **EVIDENCE** | Moves into `lib/evidence-sui/` (the only place allowed to import `@mysten/*`) | 13 |
| **COPY** | Only wording or comments mention Sui; the logic is chain-agnostic | 67 |

Starting checks on this branch, before any change (Node 24.15.0, npm 11.12.1): `test:solana` 106/106 · `test:auth` 116/116 · `lint` exit 0 · `tsc --noEmit` exit 0.

> **Toolchain note.** On Sky's laptop `npm` on PATH resolves to a stray 8.19 shim at `D:\npm`; `package.json` requires npm ≥ 11. Use `node D:\node_modules\npm\bin\npm-cli.js` (npm 11.12.1) or fix PATH. With the shim, `npm run` also picks up an old Node from `C:\Users\SKYHANDSOME\node_modules\node` and every test script fails on `--experimental-strip-types`.

---

## 1. For Sky: the DELETE list and the decisions it needs (👍 before Phase 1)

### 1.1 What gets deleted (grouped)

| Group | Files |
|---|---|
| **zkLogin** | `app/api/auth/zklogin/**`, `app/login/zklogin/callback/page.tsx`, `components/auth/ZkLoginButton.tsx`, `lib/auth/zklogin.ts`, `lib/auth/zklogin-epoch.ts`, `lib/db/wallet-identities.ts` |
| **Sui settlement core** | `lib/server/sui-settlement.ts` (203 hits, 15 importers), `lib/sui.ts`, `lib/sui/contracts.ts`, `lib/sui/gas.ts`, `lib/server/ptb.ts`, `lib/chain/compose.ts`, `lib/server/composed-payment.ts`, `lib/server/contract-config.ts`, `lib/wallet/sui-signers.ts` |
| **Old money routes** (replaced by `app/api/solana/payments/*`) | `app/api/transfers/authorize`, `app/api/batches/authorize`, `app/api/treasury`, all of `app/api/stablecoin/*` (incl. `submit`, which has no pattern hit) |
| **Peg / DeepBook** | `app/api/cron/update-peg`, `app/api/quotes/peg-status`, `lib/server/peg.ts`, `lib/server/peg-attestation.ts`, `lib/server/deepbook.ts`, `lib/policy/deepbook-whitelist.ts` |
| **USDY treasury / yield** | `app/api/cron/accrue-yield`, `lib/server/usdy.ts`, `lib/server/usdy-liquidity.ts`, `lib/payments/treasury-usdy.ts`, `components/stablecoin/UsdyPreview.tsx` |
| **MemWal** | `lib/server/memwal.ts`, `lib/server/memwal-scope.ts`, `app/api/memwal/behaviors`, `components/MemWalBehaviorCard.tsx` |
| **x402 on Sui** | `lib/payments/x402-sui.ts`, `lib/server/x402-pay.ts`, `lib/server/x402-demo-seller.ts` |
| **Sui USDC desk** | `components/stablecoin/{SendUsdcDesk,FundingPlanner,WalletActivity}.tsx`, `lib/server/usdt-ttl-guard.ts` |
| **Admin Move config** | `components/admin/ContractConfigForm.tsx` (+ `app/admin/(console)/contracts/page.tsx`, `app/api/admin/contracts`) |
| **Move packages** | all of `move/` (`splash_core`, `splash_custody`, `splash_meter`, `Published.legacy.toml`). `move/splash_evidence` is added later (Phase 2, gated on Sebastian) |
| **Scripts** | `bootstrap-testnet.ts`, `e2e-testnet.mjs`, `e2e-deployed.sh`, `fund-settlement-pool.mjs`, `rehearse-usdc-send.mjs`, `set-compliance-config.mjs`, `setup-sui-pilot.mjs`, `verify-commitment.mjs`, `check-core-no-balance.mjs`, `check-treasury-cap.mjs`, `check-abort-codes.mjs` (+ `check-cap-generations.mjs`, `splash-core-abi.mjs`) |
| **Tests of deleted modules** | the DELETE rows in §3.4, plus `oxwal-compose`, `wallet-identity-db`, `treasury-*` (§4.1) |
| **Sui-build docs** | 15 files in `docs/` (§3.6). They stay in git history at `4768824` and are described by `docs/prior-work/PRIOR_WORK.md`; a copy inside the submission tree would read as current Solana documentation |
| **Dependencies** | `@mysten/deepbook-v3`, `@mysten/wallet-standard` (both imported nowhere), `@mysten-incubation/memwal`, `@kunalabs-io/sui-snap-wallet`, `@shinami/clients` (imported nowhere), `@wallet-standard/app`. **Kept:** `@mysten/sui`, `@mysten/seal` (evidence only) |
| **npm scripts** | `setup:sui-pilot`, `bootstrap:testnet`, `rehearse:usdc`, `check:core`, `check:treasury`, `check:aborts`, `check:generations` (and their entries in `lint`) |

### 1.2 Decisions I need from you (my recommendation first)

| # | Question | Recommendation |
|---|---|---|
| D-1 | **Sui USDC wallet lane** (send-USDC desk, wallet activity, "pay this invoice in USDC" detection from the Sui wallet). Port to Solana or delete? | **Delete the desk and wallet activity** (prompt §6.2 merges send-usdc into transfer). **Port invoice-payment detection in Phase 3** against the vault ATA, since `/api/solana/invoices` doesn't cover it yet. Until then the pay-link USDC check is off |
| D-2 | **Non-custody "Phase 2" switch.** Five compliance tests gate custodial features on `custodyPackageId` (the unpublished `splash_custody` Sui package). | **Keep the gate, port the switch** to a server-only env flag that defaults off and that tests pin off. The gate is a compliance control; only its Sui trigger goes |
| D-3 | **Admin compliance controls** (peg deviation, staleness, minimum, pause) lived in the Move `compliance_config` object. | **Store them off-chain** (DB row + admin audit log). Drop the DeepBook fields. "Pause" becomes the subtractive org-suspend switch of prompt §5.6/§7 |
| D-4 | **x402 quote tool for Zeke** (`lib/agent/x402.ts`). | **Delete the Sui buyer and seller now; keep the quote-only parser** with `'sui:mainnet'` removed. Real x402 on Solana is D2 (Part D) |
| D-5 | **Daily audit batches** (`lib/server/audit-batches.ts`, anchored on Sui) vs `lib/solana-evidence` (anchored with SAS). | **Delete `audit-batches` and its 3 routes**; `lib/solana-evidence` + SAS replaces them in Phase 2 |
| D-6 | **`lib/evidence/commitment.ts`** (blake2b over Sui BCS, for Sui events). | **Delete.** Solana evidence uses `solana-evidence/canonical.ts` + sha256 leaves. `docs/commitments.md` goes with it |
| D-7 | **Funding rails** (`lib/funding/registry.ts`, `lib/payments/cctp.ts`: USDsui, `SUI_NATIVE`, CCTP V1 to Sui). | **Port to "Solana deposit + CCTP V2 inbound"** in Phase 3, aligned with the funding audit prompt at `f604453`. No Jupiter swap until that audit says so |
| D-8 | **Sui-build docs.** Delete or move to `docs/prior-work/`? | **Delete** (history keeps them). Four code comments that link them get rewritten (§4.3) |

---

## 2. Two findings that change the Phase 2 plan

1. **The server can decrypt evidence today.** `lib/server/seal.ts:160` builds the Seal `SessionKey` with `getOperatorKeypair()` from `sui-settlement`, so Splash's server holds a key that passes `seal_approve`. Prompt §4.3 requires the opposite: decryption only in the browser with the member's device key, and **"Splash's server cannot produce a valid session key for a member."** So the server-side decrypt paths are a redesign, not a move:
   - `app/api/audit/[intentId]`
   - `app/api/copilot/extract-invoice`
   - `app/api/seal/access`
   - `app/dashboard/audit/[intentId]`

   The server keeps **encrypt** (it needs no key) and loses **decrypt**.
2. **Evidence is wired into settlement.** `seal.ts` and `seal-health.ts` import `suiClient` from `lib/sui.ts` and the operator key from `sui-settlement.ts`. Both are DELETE. So `lib/evidence-sui/` needs its own Sui client and its own sponsor key (`EVIDENCE_SPONSOR_SUI_PRIVATE_KEY`, gas for allowlist updates only) **before** `sui-settlement.ts` can be deleted. Phase 2 order:
   1. create `evidence-sui`
   2. move seal and walrus into it
   3. cut the imports
   4. then delete settlement.

## 3. Every file

### 3.1 `app/` and `components/` (84 files)

| File | Hits | Action | Reason |
|---|---|---|---|
| app/admin/(console)/go-live/loading.tsx | 1 | COPY | Comment: "checks call DeepBook, Ethereum, Sui and Twilio" |
| app/admin/(console)/page.tsx | 7 | PORT | Operator wallet via `getOperatorWalletInfo`, SUI balance, faucet → Kora fee payer / attester / evidence-sponsor balances (§7) |
| app/admin/(console)/transactions/page.tsx | 26 | PORT | `readComplianceControls`, DeepBook peg zone, SuiVision links, `packageId` columns → Payments section (§7.2) |
| app/admin/login/page.tsx | 1 | COPY | Tagline "Sui settled / Walrus verified" |
| app/api/admin/compliance/route.ts | 1 | PORT | Read/write the Move `compliance_config` → off-chain store (D-3) |
| app/api/admin/wallet/route.ts | 3 | PORT | Returns Sui operator wallet → Kora, attester and evidence-sponsor balances; no private keys |
| app/api/auth/zklogin/params/route.ts | 9 | DELETE | zkLogin params. Importers: ZkLoginButton (DELETE), `scripts/e2e-deployed.sh` (DELETE), `tests/zklogin-authority` (PORT) |
| app/api/auth/zklogin/route.ts | 21 | DELETE | zkLogin JWT → Sui address → session. Importers: zklogin callback (DELETE); tests account-verification, signup-workspace, zklogin-authority (PORT, drop those cases) |
| app/api/batches/authorize/route.ts | 3 | DELETE | Batch TOTP → `recordBatchSettlementOnSui`. **Port first:** no Solana batch endpoint exists; `lib/server/approval-replay.ts` dynamically imports it; `app/dashboard/batch` fetches it |
| app/api/copilot/suggest/route.ts | 1 | COPY | Comment names MemWal; the recall is in `lib/server/copilot.ts` (PORT) |
| app/api/cron/accrue-yield/route.ts | 2 | DELETE | USDY yield + `anchorAuditHashOnSui`. Importer: `tests/phase0-custody-gate` (PORT) |
| app/api/cron/update-peg/route.ts | 1 | DELETE | `refreshPegOnSui`. Importer: `tests/prices-and-liquidity` (DELETE) |
| app/api/funding/sessions/route.ts | 2 | PORT | `USDSUI` / `SUI_NATIVE` enums; Sui deposit addresses (D-7) |
| app/api/health/route.ts | 1 | COPY | Comment; the Sui checks live in `lib/server/health-checks.ts` (PORT) |
| app/api/invoices/route.ts | 1 | COPY | Error text "paid in USDC on Sui" |
| app/api/invoices/usdc-sync/route.ts | 1 | PORT | Reads the admin's Sui wallet activity (D-1) |
| app/api/memwal/behaviors/route.ts | 2 | DELETE | MemWal recall. Importers: MemWalBehaviorCard (DELETE); tests memwal-tenant-scope (DELETE), copilot-confidence (PORT) |
| app/api/pay/[slug]/usdc/route.ts | 1 | PORT | Pay-link "I've sent it" check reads the Sui wallet (D-1) |
| app/api/quotes/peg-status/route.ts | 1 | DELETE | DeepBook peg; no UI caller. Tests prices-and-liquidity (DELETE), wire-format (edit) |
| app/api/recipients/route.ts | 2 | PORT | `normaliseSuiAddress`, Slush / MetaMask Sui Snap providers → Solana pubkey validation (users never type a chain address for partner payees) |
| app/api/stablecoin/activity/route.ts | 1 | DELETE | Sui wallet activity (D-1) |
| app/api/stablecoin/allowance/route.ts | 2 | DELETE | Sui lane allowance, SUI gas |
| app/api/stablecoin/export/route.ts | 1 | DELETE | CSV of Sui sends. A Solana payments export belongs in Phase 3 history |
| app/api/stablecoin/funding-plan/route.ts | 1 | DELETE | SUI-direct vs CCTP V1 planner |
| app/api/stablecoin/quote/route.ts | 2 | DELETE | USDC-on-Sui quote with SUI gas |
| app/api/stablecoin/treasury-quote/route.ts | 2 | DELETE | USDY quote |
| app/api/stablecoin/wallet/route.ts | 10 | DELETE | Passkey-derived Sui wallet. **Port first:** ApprovalFlow and ApprovalsInbox fetch it only for `passkey.publicKey/rpId` |
| app/api/transfers/authorize/route.ts | 6 | DELETE | Sui transfer PTB + peg gate. **Port first:** `components/transfer/StepQuote.tsx` posts to it; `approval-replay.ts` dynamically imports it; ~20 tests |
| app/api/treasury/route.ts | 1 | DELETE | USDY treasury. **Port first:** dashboard overview + treasury pages fetch it; `approval-replay.ts` imports it |
| app/dashboard/audit/[intentId]/page.tsx | 4 | PORT | "Sui digest" + SuiVision → Solana signature; evidence rows stay (decrypt moves to the browser, §2) |
| app/dashboard/batch/page.tsx | 2 | PORT | Posts `/api/batches/authorize` → chunked Solana batch (§5.5) |
| app/dashboard/copilot/page.tsx | 7 | PORT | MemWal card and panel; merges into `/dashboard/zeke` |
| app/dashboard/customer-service/page.tsx | 1 | COPY | FAQ "Receipts are sealed on Sui" |
| app/dashboard/history/page.tsx | 4 | PORT | Anchor tx on SuiVision → state-machine view with Solana Explorer links |
| app/dashboard/invoices/page.tsx | 4 | PORT | Suiscan link, Sui usdc-sync (D-1) |
| app/dashboard/overview/page.tsx | 1 | PORT | Fetches `/api/treasury` → vault USDC balance, pending approvals, last 5 payments |
| app/dashboard/page.tsx | 2 | PORT | Renders MemWalBehaviorCard |
| app/dashboard/recipients/page.tsx | 8 | PORT | "Sui wallet address", Sui Snap → partner payee record |
| app/dashboard/settings/page.tsx | 1 | COPY | "…MemWal behavioral-only"; Policy, Devices and Recovery kit tabs are added in Phase 4 |
| app/dashboard/transfer/page.tsx | 2 | COPY | "400ms Sui finality" (also a banned speed number) |
| app/dashboard/treasury/page.tsx | 5 | PORT | Becomes "Not available on this build" or leaves the nav (§4.2) |
| app/globals.css | 3 | COPY | Dead styles: `.iso-deepbook-logo`, the zkLogin block, Sui address comment |
| app/login/page.tsx | 2 | PORT | Renders ZkLoginButton → "Continue with Google" (§3.2) |
| app/login/zklogin/callback/page.tsx | 6 | DELETE | zkLogin callback. Importer: ZkLoginButton (DELETE) |
| app/opengraph-image.tsx | 1 | COPY | Chip "Sui testnet" |
| app/privacy-policy/page.tsx | 5 | COPY | "Sui test network" + the zkLogin section → Google OIDC section |
| app/receipt/[token]/page.tsx | 2 | PORT | SuiVision link, `suiTxDigest` gate → Solana verify steps (§4.5.6) |
| app/solana/page.tsx | 1 | COPY | "Prior work: the Sui build" link (accurate; keep) |
| app/terms-of-service/page.tsx | 1 | COPY | "runs against the Sui test network" |
| app/trust/page.tsx | 1 | COPY | "anchored on Sui" → SAS on Solana; Phase 6 rewrites the page |
| app/working-capital/page.tsx | 1 | COPY | "same Sui settlement rail" |
| components/FintechContextBar.tsx | 3 | COPY | "Sui settled" chip; drop the `/admin/contracts` entry |
| components/IsometricLanding.tsx | 10 | COPY | Sui/DeepBook logos, "You never hold SUI", MemWal badge (Phase 4 redraw) |
| components/MemWalBehaviorCard.tsx | 5 | DELETE | Importers: dashboard/page, dashboard/copilot, InvoiceLoop (all PORT) |
| components/Receipt.tsx | 2 | COPY | Fallback "Sui · sandbox" |
| components/SettlementProofDrawer.tsx | 5 | EVIDENCE | Walrus blob / Seal policy / ciphertext-hash / anchor verify UI; its settlement link moves to Solana Explorer |
| components/SplashLoading.tsx | 1 | COPY | Loader label "SUI" |
| components/admin/ComplianceControlForm.tsx | 7 | PORT | Drop DeepBook fields and "Update on Sui" (D-3) |
| components/admin/ContractConfigForm.tsx | 12 | DELETE | Move package / AdminCap config. Importer: `app/admin/(console)/contracts/page.tsx` (DELETE, no pattern hit) |
| components/admin/GoLiveView.tsx | 4 | PORT | Drop Sui node, peg, Sui RPC, Enoki checks; add Kora/SAS/Walrus checks |
| components/approvals/ApprovalFlow.tsx | 1 | PORT | `signApprovalWithPasskey` (Sui PasskeyKeypair) → device-key signing |
| components/approvals/ApprovalsInbox.tsx | 1 | PORT | Same as ApprovalFlow |
| components/auth/IsometricAuthShell.tsx | 1 | COPY | "Atomic settlement on Sui"; login carries no chain names (§3.2) |
| components/auth/PasskeyEnrolment.tsx | 5 | PORT | Derives a Sui address from the passkey → plain WebAuthn second factor |
| components/auth/ZkLoginButton.tsx | 10 | DELETE | Importers: `app/login/page.tsx` (PORT), `scripts/check-copy.mjs` (PORT), `tests/zklogin-authority` (PORT) |
| components/compliance/TrustCompliance.tsx | 2 | COPY | "anchored on Sui", Sui confidential transfers (out of scope, §12) |
| components/dashboard/DashboardShell.tsx | 2 | COPY | Sui logo + "Sui testnet ready" → "Solana devnet" chip (§6.2) |
| components/dashboard/ExplorerLinks.tsx | 4 | PORT | SuiScan/SuiVision pair → Solana Explorer |
| components/dashboard/SettlementEngineFlow.tsx | 2 | COPY | "Splash · Sui", "400ms Sui finality" |
| components/funding/FundingSelector.tsx | 3 | PORT | `SUI_NATIVE` rail (D-7) |
| components/invoices/InvoiceLoop.tsx | 3 | PORT | Renders MemWalBehaviorCard; "USDC on Sui" |
| components/landing/Landing.tsx | 2 | COPY | "Final on Sui", "Sandbox on the Sui testnet" |
| components/landing/SettlementCinematic.tsx | 2 | COPY | Sui token image; redrawn vault → approve → partner → receipt in Phase 4 |
| components/mobile/MobileLanding.tsx | 3 | COPY | "Sui settlement finality", Sui logo |
| components/pay/PayInvoiceClient.tsx | 2 | COPY | "USDC payments on Sui only" |
| components/pay/PayWithUsdc.tsx | 9 | PORT | Pay-link USDC flow on Sui (D-1) |
| components/stablecoin/FundingPlanner.tsx | 3 | DELETE | Importer: SendUsdcDesk (DELETE) |
| components/stablecoin/SendUsdcDesk.tsx | 39 | DELETE | Importers: `app/dashboard/send-usdc/page.tsx` (DELETE, no hit; route redirects to transfer), `tests/usdc-handoff` (PORT) |
| components/stablecoin/UsdyPreview.tsx | 3 | DELETE | Importer: SendUsdcDesk (DELETE) |
| components/stablecoin/WalletActivity.tsx | 6 | DELETE | Importer: SendUsdcDesk (DELETE) |
| components/transfer/StepDelivery.tsx | 1 | COPY | "Wallet: USDC on Sui" |
| components/transfer/StepQuote.tsx | 1 | PORT | Posts `/api/transfers/authorize` and Sui funding sessions → `/api/solana/payments/*` |
| components/transfer/StepReceipt.tsx | 2 | PORT | SuiVision link → Solana Explorer |
| components/transfer/StepStatus.tsx | 2 | COPY | "One composed Sui transaction" |

### 3.2 `lib/` (87 files)

| File | Hits | Action | Reason |
|---|---|---|---|
| lib/agent/assistant-name-shared.ts | 1 | COPY | Comment mentions MemWal |
| lib/agent/assistant-name.ts | 6 | PORT | Nickname stored in MemWal → DB column |
| lib/agent/oxwal.ts | 26 | PORT | Calls `composeAndSimulateProposal` (Sui) and USDY APY; prompt text says "USDC on Sui", SUI gas → Zeke on Solana, draft-only |
| lib/agent/recipient-tools.ts | 3 | COPY | Strings only |
| lib/agent/usdc-handoff.ts | 5 | COPY | Regex/strings: "on sui", SUI gas |
| lib/agent/x402.ts | 5 | PORT | `'sui:mainnet'` in known networks (D-4) |
| lib/agent/zeke-lane-guard.ts | 4 | COPY | Refusal strings mention Sui |
| lib/auth/accounts.ts | 1 | COPY | Comment |
| lib/auth/customer-session.ts | 1 | PORT | `suiAddress?` on the session → device-key public key from org membership |
| lib/auth/idle-timeout.ts | 1 | COPY | Comments on zkLogin maxEpoch |
| lib/auth/passkey.ts | 4 | PORT | Verifies through `@mysten/sui/keypairs/passkey` → plain WebAuthn (P-256) as a login second factor |
| lib/auth/signup-org.ts | 3 | COPY | History comment |
| lib/auth/zklogin-epoch.ts | 5 | DELETE | Importers: zklogin params route (DELETE), `tests/zklogin-authority` (PORT) |
| lib/auth/zklogin.ts | 44 | DELETE | Importers: zklogin routes + button (DELETE); tests account-verification, wallet-onboarding (PORT, drop cases) |
| lib/chain/compose.ts | 3 | DELETE | Sui PTB builder. Importers: `lib/agent/oxwal.ts` (PORT: swap to `lib/solana/simulator.ts`), `tests/oxwal-compose` (DELETE) |
| lib/compliance/kyb-state.ts | 1 | COPY | Comment |
| lib/compliance/org-kyb.ts | 2 | PORT | KYB state stays; `approveOrgKybOnChain` (AdminCap) goes. KYB tier can be attested with SAS later |
| lib/db/schema.ts | 10 | PORT | `sui_address` columns, Sui recipient check, `batch_runs.package_id` → Solana pubkey columns (migration in Phase 1/3) |
| lib/db/wallet-identities.ts | 5 | DELETE | zkLogin signer map. Importers: zklogin route (DELETE), tests wallet-identity-db, zklogin-authority |
| lib/env.ts | 45 | PORT | Drop Sui settlement, DeepBook, USDsui, Enoki, zkLogin, MemWal keys; keep the evidence keys of §4.5; `ENGINE_HOME_CHAIN` loses `'sui'` |
| lib/evidence/commitment.ts | 3 | EVIDENCE | blake2b over Sui BCS. **Recommend delete** (D-6) |
| lib/evidence/settlement.ts | 0 | EVIDENCE | Seal-encrypt + Walrus-store evidence (no hit; imports seal/walrus) |
| lib/explorer.ts | 21 | PORT | SuiVision/Suiscan/faucet helpers → Solana Explorer with the cluster param (12 importers) |
| lib/funding/registry.ts | 11 | PORT | USDSUI, `SUI_NATIVE`, DEX route (D-7) |
| lib/fx/corridors.ts | 1 | COPY | Comment |
| lib/launch-scope-rules.ts | 2 | COPY | "USDC on Sui only" |
| lib/money.ts | 2 | PORT | `MIST_DECIMALS = 9` only used by sui-settlement → remove; USDC 6 decimals stay |
| lib/network-label.ts | 3 | PORT | Reads `SUI_NETWORK` → `SOLANA_CLUSTER` |
| lib/payments/cctp.ts | 24 | PORT | CCTP V1 to Sui (domain 8) → superseded by `lib/solana/cctp-v2-solana.ts` for outbound; inbound in D-7 |
| lib/payments/stablecoin-lane.ts | 30 | PORT | Lane policy (caps, windows) is chain-agnostic; Sui coin types and addresses go (D-1) |
| lib/payments/stablecoin-verify.ts | 2 | PORT | `@mysten/sui/utils` normalisers (D-1) |
| lib/payments/treasury-usdy.ts | 9 | DELETE | Importers: treasury-quote route (DELETE), tests funding-and-treasury, prices-and-liquidity (DELETE) |
| lib/payments/usdc-invoice.ts | 2 | COPY | Comments ("A Sui transfer carries no memo"; Solana has the memo) |
| lib/payments/usdc-records.ts | 1 | COPY | Comment |
| lib/payments/x402-sui.ts | 9 | DELETE | Importers: tests x402-sui, x402-demo-seller (DELETE) |
| lib/policy/batch-limits.ts | 5 | PORT | Sized to Sui's 1,024-command cap and MIST gas → size-driven Solana chunking (§5.5) |
| lib/policy/deepbook-whitelist.ts | 14 | DELETE | Importer: `tests/deepbook-pool-whitelist` (DELETE) |
| lib/policy/limits.ts | 1 | COPY | Comment mentions DeepBook; links KEY-CEREMONY-RUNBOOK (deleted) |
| lib/server/audit-batches.ts | 2 | PORT | Daily Merkle anchored on Sui. **Recommend delete** with its 3 routes (D-5) |
| lib/server/batches-store.ts | 5 | PORT | SuiVision URLs, `packageId` |
| lib/server/composed-payment.ts | 1 | DELETE | Sui payment intent. Importer: `app/api/transfers/authorize` (DELETE) |
| lib/server/contract-config.ts | 24 | DELETE | Move object ids. Importers: admin contracts page + API (DELETE), `custody-phase.ts` (PORT, D-2), `operations.ts` (PORT) |
| lib/server/copilot.ts | 5 | PORT | MemWal recall + USDY rate |
| lib/server/custody-phase.ts | 3 | PORT | Switch = `custodyPackageId` → env flag, default off (D-2) |
| lib/server/customer-auth.ts | 1 | COPY | Comment |
| lib/server/deepbook.ts | 15 | DELETE | Only importer `peg.ts` (DELETE) |
| lib/server/dual-approval.ts | 1 | COPY | Comment "dry-run PTB" |
| lib/server/funding-intake.ts | 2 | PORT | `SUI_NATIVE` branch (D-7) |
| lib/server/funding-normalization.ts | 1 | PORT | USDsui/USDT → USDC via Sui DEXes + `readComplianceControls` (D-7) |
| lib/server/funding-sessions.ts | 3 | PORT | Deposit address via Sui `Ed25519Keypair` (D-7) |
| lib/server/go-live-checks.ts | 13 | PORT | Sui node, DeepBook peg, USDY NAV → Kora, SAS, Walrus, Seal checks |
| lib/server/health-checks.ts | 22 | PORT | Sui RPC/package/Enoki probes → Solana RPC + Kora; seal check → evidence health |
| lib/server/intercompany.ts | 1 | COPY | Comment |
| lib/server/labuan-settlement.ts | 2 | COPY | Comments |
| lib/server/memwal-scope.ts | 11 | DELETE | Importer: `tests/memwal-tenant-scope` (DELETE) |
| lib/server/memwal.ts | 25 | DELETE | Importers: memwal route (DELETE); `assistant-name.ts`, `copilot.ts`, `operations.ts` (PORT) |
| lib/server/operations.ts | 16 | PORT | Sui explorer, `packageId`, `rememberForOrg`, `memwalRecordId` |
| lib/server/peg-attestation.ts | 6 | DELETE | Importers: update-peg cron (DELETE), `tests/prices-and-liquidity` (DELETE) |
| lib/server/peg.ts | 17 | DELETE | Importers: admin transactions (PORT), peg-status route, transfers/authorize (DELETE), `go-live-checks.ts` (PORT) |
| lib/server/ptb.ts | 4 | DELETE | No importers |
| lib/server/rate-limit.ts | 3 | COPY | Comments |
| lib/server/repository/batches.ts | 6 | PORT | `package_id` column mapping |
| lib/server/repository/invoices.ts | 1 | COPY | Comment |
| lib/server/repository/recipients.ts | 2 | COPY | Comments |
| lib/server/repository/transfers.ts | 1 | COPY | Comment "Sui digest" |
| lib/server/seal-config.ts | 9 | EVIDENCE | Seal key-server config → `lib/evidence-sui/seal-config.ts` |
| lib/server/seal-health.ts | 2 | EVIDENCE | → `lib/evidence-sui/seal-health.ts`; needs its own Sui client (§2) |
| lib/server/seal.ts | 7 | EVIDENCE | → `lib/evidence-sui/seal.ts`; server decrypt removed, operator key replaced (§2) |
| lib/server/stablecoin-chain.ts | 15 | PORT | Sui gasless USDC transfer (D-1; likely DELETE if the desk goes) |
| lib/server/stablecoin-deps.ts | 1 | COPY | Comment; follows the schema rename |
| lib/server/stablecoin-send.ts | 14 | PORT | Sui send (D-1; likely DELETE if the desk goes) |
| lib/server/step-up-subjects.ts | 2 | COPY | "on Sui mainnet" in approval text |
| lib/server/step-up.ts | 1 | PORT | Passkey verify via `@mysten/sui` → WebAuthn |
| lib/server/sui-settlement.ts | 203 | DELETE | **15 importers**, including `seal.ts`. Deleted last in Phase 2 (§2) |
| lib/server/transfers-store.ts | 3 | PORT | `memwalRecordId` field |
| lib/server/usdc-invoice-payments.ts | 2 | PORT | Sui wallet reads (D-1) |
| lib/server/usdc-records.ts | 1 | COPY | Comment |
| lib/server/usdt-ttl-guard.ts | 1 | DELETE | No importers |
| lib/server/usdy-liquidity.ts | 8 | DELETE | Importers: treasury-quote route, `tests/prices-and-liquidity` (DELETE) |
| lib/server/usdy.ts | 7 | DELETE | Importers: market/yields, treasury-quote, treasury routes; `lib/server/treasury.ts`; `oxwal.ts`, `copilot.ts`, `go-live-checks.ts` (PORT); tests treasury-nav, prices-and-liquidity |
| lib/server/wallet-activity.ts | 5 | PORT | Sui GraphQL USDC activity (D-1) |
| lib/server/walrus.ts | 0 | EVIDENCE | Walrus publisher/aggregator over HTTP → `lib/evidence-sui/walrus.ts`; `epochs: 5` default to revisit (§4.5) |
| lib/server/x402-demo-seller.ts | 7 | DELETE | Importers: x402 demo route, `tests/x402-demo-seller` |
| lib/server/x402-pay.ts | 6 | DELETE | Importers: x402 pay/probe/quote routes, `lib/server/x402-deps.ts`, `tests/x402-sui` |
| lib/solana-evidence/anchor.ts | 2 | PORT | SAS field `sui_digest` → `walrus_blob_ids_root`, schema `splash.evidence.root.v2` (§4.5.5) |
| lib/sui.ts | 4 | DELETE | Importers: `audit-batches`, `health-checks` (PORT); `seal`, `seal-health` (EVIDENCE: get own client); scripts e2e-testnet, verify-commitment (DELETE) |
| lib/sui/contracts.ts | 5 | DELETE | No importers |
| lib/sui/gas.ts | 1 | DELETE | Only importer `lib/sui/contracts.ts` (DELETE) |
| lib/wallet/sui-signers.ts | 16 | DELETE | Importers: ApprovalFlow, ApprovalsInbox (PORT), SendUsdcDesk (DELETE) |

*(`lib/evidence/settlement.ts` and `lib/server/walrus.ts` show 0 hits on the strict pattern but are listed because they belong to the evidence move.)*

### 3.3 `config/`, `content/`, `README.md`

| File | Hits | Action | Reason |
|---|---|---|---|
| README.md | 2 | COPY | Prior-work disclosure and founder bio ("Sui Community Malaysia"); both true, keep |
| config/README.md | 2 | EVIDENCE | Documents `config/seal.<env>.json` |
| config/seal.development.json | 1 | EVIDENCE | Empty `packageId`; filled only after Sebastian publishes `splash_evidence` (G1) |
| config/seal.production.json | 1 | EVIDENCE | Same |
| config/seal.test.json | 1 | EVIDENCE | Same |
| content/claims.ts | 4 | COPY | "~400ms Sui settlement finality" (banned speed number), "anchored on Sui" |
| content/sea-numbers.ts | 5 | COPY | `sui-finality` entry and a testnet note; remove the entry |

### 3.4 `tests/` (50 files)

| File | Hits | Action | Reason |
|---|---|---|---|
| tests/account-verification.test.mjs | 4 | PORT | Drop the one zkLogin case |
| tests/approved-payout-once.test.mjs | 2 | PORT | `SUI_NATIVE` rail fixture |
| tests/assistant-name.test.mjs | 5 | PORT | Follows the nickname store off MemWal |
| tests/batch-persistence.test.mjs | 2 | PORT | `packageId` column |
| tests/copilot-confidence.test.mjs | 7 | PORT | Drop MemWal env and card assertions |
| tests/core-invariant-check.test.mjs | 13 | DELETE | Tests `check-core-no-balance.mjs` over `move/splash_core` |
| tests/custody-phase-surfaces.test.mjs | 2 | PORT | `custodyPackageId` switch (D-2) |
| tests/deepbook-liquidity-guard.test.mjs | 8 | DELETE | `liquidity_guard.move` arithmetic |
| tests/deepbook-pool-whitelist.test.mjs | 10 | DELETE | Tests `lib/policy/deepbook-whitelist.ts` |
| tests/delivery-tier-phase-lock.test.mjs | 2 | PORT | `custodyPackageId` switch (D-2) |
| tests/e2e-verify-abi.test.mjs | 2 | DELETE | splash-core ABI vs Move source |
| tests/env.test.mjs | 6 | PORT | `suiprivkey` fixture, zkLogin and Enoki cases |
| tests/event-privacy.test.mjs | 4 | EVIDENCE | Keep the Seal round-trip; drop the splash_core event and verify-commitment cases (D-6) |
| tests/explorer.test.mjs | 16 | PORT | Solana Explorer helper; keep the "no hand-built URL" guard |
| tests/funding-and-treasury.test.mjs | 7 | DELETE | CCTP-to-Sui + USDY |
| tests/funding-registry.test.mjs | 5 | PORT | USDSUI / `SUI_NATIVE` (D-7) |
| tests/go-live-checks.test.mjs | 4 | PORT | Drop the DeepBook peg and USDY cases |
| tests/health.test.mjs | 2 | PORT | `SUI_NETWORK`, `SUI_SETTLEMENT_MODE`, `FEATURE_ZKLOGIN`, Enoki header |
| tests/invoice-currency-read.test.mjs | 4 | PORT | MemWal env deletes |
| tests/invoice-delivery-tier.test.mjs | 3 | PORT | `custodyPackageId` switch (D-2) |
| tests/launch-scope-routes.test.mjs | 1 | PORT | Asserts "USDC on Sui only" |
| tests/launch-scope.test.mjs | 8 | PORT | "USDC on Sui", `suiprivkey` signer, coin-type check |
| tests/memwal-tenant-scope.test.mjs | 19 | DELETE | MemWal |
| tests/money.test.mjs | 1 | COPY | Comment |
| tests/oxwal-approval-queue.test.mjs | 1 | COPY | Fixture coinType `0x2::sui::SUI` → USDC mint |
| tests/oxwal-capabilities.test.mjs | 4 | PORT | MemWal nickname test |
| tests/oxwal-e2e.test.mjs | 2 | COPY | `sig-human-zklogin-*` ids → `sig-human-device-*` |
| tests/oxwal-frontend.test.mjs | 2 | COPY | Asserts check-copy still bans "Sui network live"; keep |
| tests/oxwal-state-machine.test.mjs | 1 | COPY | Fixture coinType |
| tests/phase0-custody-gate.test.mjs | 7 | PORT | `custodyPackageId` switch (D-2); drops the accrue-yield import |
| tests/prices-and-liquidity.test.mjs | 31 | DELETE | Peg, USDY price and liquidity |
| tests/receipt-share.test.mjs | 3 | PORT | Network label "Sui · sandbox" → Solana |
| tests/seal-config.test.mjs | 2 | EVIDENCE | Seal config parser |
| tests/seal-decentralized.integration.mjs | 9 | EVIDENCE | Live Seal round trip (opt-in) |
| tests/signup-workspace.test.mjs | 5 | PORT | Drop the two zkLogin route tests |
| tests/solana-engine-route.test.mjs | 3 | COPY | `'sui'` as a non-Solana home-chain fixture; rename when `ENGINE_HOME_CHAIN` loses `'sui'` |
| tests/stablecoin-gasless.test.mjs | 6 | DELETE | Sui gasless send |
| tests/stablecoin-lane.test.mjs | 4 | PORT | Lane policy (D-1) |
| tests/stablecoin-send.test.mjs | 14 | DELETE | Sui tx bytes, SUI gas |
| tests/sweep-account-switch.test.mjs | 2 | PORT | `SPLASH_CUSTODY_PACKAGE_ID` switch (D-2) |
| tests/usdc-handoff.test.mjs | 3 | PORT | "a little SUI for gas" line |
| tests/usdc-invoice-payments.test.mjs | 3 | DELETE | Sui wallet activity (rewritten in Phase 3 if D-1 ports detection) |
| tests/wallet-activity-and-records.test.mjs | 6 | DELETE | Sui GraphQL indexer (D-1) |
| tests/wallet-onboarding.test.mjs | 26 | PORT | Drop the zkLogin JWT section; KYB/session tests stay |
| tests/wallet-recipients.test.mjs | 1 | PORT | DB check refuses Phantom, requires Sui `0x` → Solana pubkeys |
| tests/x402-demo-seller.test.mjs | 3 | DELETE | x402 on Sui |
| tests/x402-sui.test.mjs | 13 | DELETE | x402 on Sui |
| tests/x402.test.mjs | 1 | PORT | Quote-only tool (D-4) |
| tests/zeke-lane-guard.test.mjs | 2 | COPY | Asserts "USDC on Sui" |
| tests/zklogin-authority.test.mjs | 18 | PORT | Becomes the device-key authority test ("identity authorizes nothing"); `test:auth` points at the new file |

### 3.5 `scripts/` (18 files)

| File | Hits | Action | Reason |
|---|---|---|---|
| scripts/bootstrap-testnet.ts | 13 | DELETE | Sui testnet bootstrap |
| scripts/check-abort-codes.mjs | 2 | DELETE | Move abort codes vs sui-settlement; both inputs deleted |
| scripts/check-compliance-subtractive.mjs | 4 | PORT | Scans `move/splash_core` for `&ComplianceCap`. New target: assert the admin compliance code can only suspend/refuse (no transfer, no member change), plus I-1 on vault creation |
| scripts/check-copy.mjs | 4 | PORT | Explorer-literal rule → Solana explorers; drop ZkLoginButton colours; keep the "Sui network live" ban |
| scripts/check-core-no-balance.mjs | 12 | DELETE | Its target `move/splash_core` is deleted. The Solana equivalent is I-1/I-2 (no Splash key on a vault, no Splash destination), already tested |
| scripts/check-env-reads.mjs | 1 | PORT | Comment about zklogin.ts |
| scripts/check-treasury-cap.mjs | 8 | DELETE | TreasuryCap in Move; treasury not ported |
| scripts/copy-rules.mjs | 1 | COPY | Bans "PTB" on marketing routes; harmless |
| scripts/dev-db.mjs | 4 | COPY | Seed blurbs "USDC on Sui mainnet (real)" |
| scripts/doctor.mjs | 4 | PORT | Sui RPC, Enoki, peg, USDY checks → Solana RPC, Kora, Walrus, Seal |
| scripts/e2e-deployed.sh | 8 | DELETE | Probes the deployed Sui v2 |
| scripts/e2e-testnet.mjs | 33 | DELETE | splash_core publish e2e |
| scripts/fund-settlement-pool.mjs | 15 | DELETE | `SettlementPool<SUI>` |
| scripts/rehearse-usdc-send.mjs | 22 | DELETE | Sui mainnet USDC rehearsal |
| scripts/seed-demo-user.mjs | 2 | COPY | "USDC lane Sui mainnet" log line |
| scripts/set-compliance-config.mjs | 19 | DELETE | On-chain ComplianceConfig + DeepBook whitelist |
| scripts/setup-sui-pilot.mjs | 11 | DELETE | Sui Pilot clone. **Re-add only if Sebastian wants it for `splash_evidence` review** |
| scripts/verify-commitment.mjs | 3 | DELETE | Verifies against Sui events; superseded by `lib/solana-evidence/verify.ts` |

### 3.6 `docs/*.md` (top level, 17 files)

| File | Hits | Action | Reason |
|---|---|---|---|
| docs/DEPLOY-DIGITALOCEAN.md | 11 | DELETE | Sui env table. If the Solana app deploys the same way, Phase 6 writes a fresh deploy doc |
| docs/GO-LIVE-HANDOVER.md | 22 | DELETE | Sui go-live; linked from `lib/launch-scope-rules.ts` (comment rewritten) |
| docs/HANDOVER-2026-09-06.md | 8 | DELETE | Sui handover |
| docs/HANDOVER-SEBASTIAN.md | 26 | DELETE | Sui CLI / Move handover |
| docs/KEY-CEREMONY-RUNBOOK.md | 74 | DELETE | AdminCap/TreasuryCap ceremony; linked from `lib/policy/limits.ts` |
| docs/KEY-POLICY.md | 5 | DELETE | Sui multisig key policy. The Solana key policy (Kora signer, attester, evidence sponsor; two-person control) is written fresh in Phase 6 |
| docs/MAINNET-CHECKLIST.md | 5 | DELETE | Sui mainnet checklist |
| docs/ONBOARDING-SCOPE.md | 2 | COPY | Two zkLogin rows → device key + Google/email |
| docs/PHASE-STATUS.md | 10 | DELETE | Sui build phase tracker |
| docs/PRODUCT-WALKTHROUGH.md | 2 | DELETE | July Sui demo script |
| docs/STABLECOIN-LANE.md | 58 | DELETE | Sui USDC lane; linked from GoLiveView and go-live-checks |
| docs/UPGRADE-POLICY.md | 3 | DELETE | Sui UpgradeCap |
| docs/X402-ASSESSMENT.md | 6 | DELETE | x402 on Sui; linked from `lib/agent/x402.ts`, `oxwal.ts`, `types.ts` |
| docs/commitments.md | 7 | EVIDENCE | Sui commitment vectors. **Recommend delete** with `commitment.ts` (D-6) |
| docs/contract-config.md | 16 | DELETE | Move object ids |
| docs/sui-contract-standards.md | 6 | DELETE | Sui/OZ Move standards. Sebastian may want the relevant parts for `splash_evidence` (Phase 2 can cite it from history) |
| docs/sui-pilot.md | 9 | DELETE | Sui Pilot setup |

## 4. Outside the grep, but must move in the same sweep

### 4.1 No pattern hit, but imports something being deleted

| File | Depends on | Action |
|---|---|---|
| app/admin/(console)/contracts/page.tsx | ContractConfigForm, contract-config | DELETE |
| app/api/admin/contracts/route.ts | contract-config | DELETE |
| app/dashboard/send-usdc/page.tsx | SendUsdcDesk | DELETE → 308 to `/dashboard/transfer` |
| app/api/stablecoin/submit/route.ts | Sui lane | DELETE |
| app/api/x402/{pay,probe,quote,demo/corridor-fees}/route.ts | x402-pay, x402-demo-seller | DELETE (D-4) |
| app/api/market/yields/route.ts | usdy | DELETE |
| app/api/audit-batches/route.ts, app/api/audit-batches/verify/route.ts, app/api/cron/audit-batch/route.ts | audit-batches | DELETE (D-5) |
| app/api/seal/access/route.ts, app/api/audit/[intentId]/route.ts, app/api/copilot/extract-invoice/route.ts | seal.ts server decrypt | PORT: browser decrypt (§2) |
| app/api/walrus/[blobId]/route.ts | walrus.ts | EVIDENCE |
| lib/server/approval-replay.ts | dynamic imports of transfers/batches/treasury routes | PORT: rewire to `app/api/solana/payments/*` **before** those routes go |
| lib/server/x402-deps.ts | x402-pay | DELETE |
| lib/server/treasury.ts | usdy | DELETE |
| scripts/check-cap-generations.mjs, scripts/splash-core-abi.mjs | move/splash_core | DELETE |
| tests/oxwal-compose.test.mjs | lib/chain/compose.ts | DELETE |
| tests/passkey-authority.test.mjs, tests/step-up.test.mjs | `@mysten/sui` passkey verify | PORT (WebAuthn) |
| tests/treasury-*.test.mjs | treasury | DELETE (treasury not ported) |
| tests/wallet-identity-db.test.mjs | wallet-identities | DELETE |

### 4.2 Root docs (not in the grep's scope)

| File | Hits | Action |
|---|---|---|
| AGENTS.md | 10 | COPY: keep the Sui Move workflow section, scoped to `move/splash_evidence` only |
| SECURITY.md | 97 | PORT: rewrite for the Solana trust model (vault, Kora, attester, evidence sponsor) |
| STATUS.md | 21 | PORT: rewrite (Phase 6) |
| HANDOVER.md | 25 | DELETE (Sui v2 deploy handover); replaced by the Phase 6 docs |
| CHANGES.md | 4 | PORT: add a Solana-everywhere entry; keep history |

### 4.3 Code comments that link deleted docs

- `lib/launch-scope-rules.ts` → GO-LIVE-HANDOVER
- `lib/policy/limits.ts` → KEY-CEREMONY-RUNBOOK
- `components/admin/GoLiveView.tsx`, `lib/server/go-live-checks.ts` → STABLECOIN-LANE
- `lib/agent/x402.ts`, `lib/agent/oxwal.ts`, `lib/agent/types.ts` → X402-ASSESSMENT

## 5. Route map (`/solana/*` → `/dashboard/*`, Phase 4)

Old URLs return **308** from `proxy.ts`.

| Old route | New route | Notes |
|---|---|---|
| `/solana` | `/dashboard` | Landing-demo entry becomes the dashboard overview |
| `/solana/onboarding` | `/dashboard/setup` | `/dashboard/setup` already exists (KYB stepper). Device key → recovery kit → vault are **added** as steps; the KYB steps stay |
| `/solana/fund` | `/dashboard/fund` | New page |
| `/solana/pay` | `/dashboard/transfer` | Replaces the Sui transfer wizard; `send-usdc` merges in |
| `/solana/policy` | `/dashboard/settings/policy` | New settings tab |
| `/solana/zeke` | `/dashboard/zeke` | `copilot` and `0xwal` merge in and redirect |
| `/solana/receipts/[id]` | `/dashboard/receipts/[id]` | **Not in the prompt's map; my proposal.** The public `/receipt/[token]` share link stays and gains the §4.5.6 verify steps |
| `/dashboard/send-usdc` | `/dashboard/transfer` | 308 |
| `/dashboard/transfers` | `/dashboard/history` | Merged (§6.2) |
| `/dashboard/copilot`, `/dashboard/0xwal` | `/dashboard/zeke` | 308 |
| `/dashboard/treasury` | stays, "Not available on this build" | Or removed from nav |

API: `app/api/solana/**` keeps its paths (18 routes). The dashboard pages call them directly.
