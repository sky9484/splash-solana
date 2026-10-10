# Splash Solana build prompt (v15.1, rev 2) — repo `sky9484/splash-solana`

**For:** whoever builds next (Sebastian, Sky, or a coding agent) · **Written:** 11 Oct 2026 (rev 2, after Sky's answers) · **Hard deadline:** Colosseum submission **12 Oct 2026**.
**Dates:** Part A **today → 12 Oct** · Part B by **24 Oct** · Part C by **31 Oct** · Part D after that, gated.
**Canon:** Business Module v15.1 (locked 11 Oct 2026). Design: `docs/solana-build/design-brief.md`. Spec: `docs/solana-build/SPEC.md`. Where this prompt and canon disagree, canon wins; ask Sky before guessing.
**Paste everything below the line into Claude Code at the repo root.**

---

You are working in `sky9484/splash-solana`. It is a Next.js 16 app. Its **first commit (`4768824`) is the Sui build imported unchanged as prior work**; every later commit is the Solana build for Colosseum. Read this whole prompt before writing code. Work in the order of the parts, and inside a part in the order of the tasks. A task is done only when every acceptance box passes and you have pasted the evidence (command output, test names, signatures, explorer links, screenshots) into the PR or commit message. If a box can't pass, say so in the README's "Not verified yet" list; never tick a box you didn't see pass.

## 0. Ground rules (non-negotiable)

1. **Read before you write.**
   - `AGENTS.md`, `CLAUDE.md`, `docs/solana-build/SPEC.md`, `docs/solana-build/design-brief.md`, `docs/solana-build/VIDEO.md`, `docs/prior-work/PRIOR_WORK.md`, `README.md`, `lib/solana/types.ts` (the shared contract every module uses).
   - This Next.js version has breaking changes. Read the guide in `node_modules/next/dist/docs/` before touching routes, layouts, server components or route handlers.
2. **Load the skills** at the start and say which are missing:
   - Solana money flows: `solana-payments-engineer` (always).
   - Security and QA: `fintech-security-compliance`, `qa-verification-engineer`.
   - Agent and finance logic: `agentic-finance-expert`, `payments-treasury-expert`, `fintech-architect`, `ai-agent-systems-architect`.
   - UI: `ui-ux-pro-max`, `isometric-typography-designer`, `frontend-design`, `design-taste-frontend`. (The 11 Oct build had only `frontend-design` and `isometric-typography-designer`. Run the UI through the other two when you have them.)
3. **Branches (Sky, 11 Oct: "merge to main").**
   - `main` is the default branch and the one judges see. On 11 Oct the remote has **no `main` yet**; A4 creates it from `build/solana-colosseum` and sets it as the GitHub default.
   - After A4, work on one branch per task: `sol/<task-id>-<slug>` (e.g. `sol/b1-kora`), cut from `main`. Open a PR to `main`. Sky or Sebastian merges. Never force-push `main`.
4. **Colosseum honesty.**
   - Only work between 14 Sep and 12 Oct 2026 is judged. Commit `4768824` is prior work and stays labelled so. Never squash it into Solana commits, and never rewrite history before A4.
   - Never claim a devnet result that doesn't have a signature in `docs/solana-build/devnet-run.json`.
   - "Simulated · devnet-ready" stays on every screen and receipt produced offline.
5. **Claims discipline in every string a user or judge can read** (UI, README, video, submission form, social posts).
   - Never: "licensed" (about Splash or a partner), yield, APY, escrow, netting, "gasless", "autonomous", "guaranteed", "instant", "no human approval", any finality number.
   - v15.1 §14.9: never "partnered with AEON", "VAA-integrated", "verified by Google Cloud", "built on Sui Agent Payments", "autonomous payments".
   - **Payout partner (Sky, 11 Oct: "sandbox").** No partner is signed. Use the mock or a sandbox only, and never name a partner in UI, README, video or submission. Say "payout partner". The mock is "Mock partner · devnet"; a sandbox adapter shows "Partner sandbox".
   - Say "You don't need SOL" only on the Solana direct route. The CCTP route says "Needs 0.01 SOL in the vault (test pending)" until B4 removes the need.
   - Approved sentences: "Splash never holds the money." · "Your vault, your keys." · "Zeke drafts. A person approves." · "Screened before every payment." (only once C5 exists).
   - `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/check-copy.mjs` must pass on every commit.
6. **Secrets.** The 24 words and the device private key exist only in the browser. No mnemonic, private key, API key, Kora signer key or HMAC secret in the repo, logs, analytics, Walrus or test fixtures; generate throwaway keys inside tests. `docs/solana-build/devnet-run.json` holds public keys and signatures only. The e2e keypair lives in `~/.config/solana/`, never in the repo (add it to `.gitignore` patterns if you change paths).
7. **Money.** bigint minor units everywhere (USDC 6 decimals, PHP centavos). Use `lib/money.ts`. No floats on money, including fee and FX maths.
8. **Run mode.** `SPLASH_SOLANA_MODE=offline` (default) touches no network. `devnet` uses `SOLANA_RPC_URL`, `KORA_RPC_URL`, `KORA_API_KEY`. `readSolanaEnv` refuses mainnet, and keeps refusing it until D1's gate passes.

## 1. What this build is (keep it in your head)

Splash is **self-custodial settlement software**. A Malaysian business pays a Philippine supplier's invoice in USDC on Solana:
- the business holds its own **autonomous Squads V4 vault** (device key + recovery kit; `configAuthority` null; no Splash member);
- **Zeke** reads the invoice in quarantine and explains routes; it can only draft;
- the **route engine** ranks Solana direct against a CCTP V2 burn to the partner's Polygon address, by **pesos the supplier receives**;
- **policy runs as code**; **a person signs** with the device key; **Kora** (run by Splash) pays the network fee;
- a **payout partner of record** (mock today, sandbox next) pays the supplier's bank;
- every payment leaves an **evidence bundle** whose Merkle root is anchored on Solana (SPL Memo now, SAS next).

### Decisions Sky locked on 11 Oct (build to these)
| Topic | Decision | Where it lands |
|---|---|---|
| Payout partner | **Sandbox** only until signed; never named | B6 |
| Default branch | **Merge to `main`**; `main` is the GitHub default | A4 |
| Kora | **Splash runs Kora**. The signer key sits in a remote key manager. **Splash's CEO and head of finance must both approve** any key rotation, top-up or policy change | B1 |
| Polygon mint | **Partner relayer first, Splash relayer as backup** (after a timeout, Splash submits the same attestation) | B5 |
| Passkeys | **Claude picks, after the audit check → LazorKit**, gated by a devnet test that it can approve a Squads proposal; else keep the device key | C2 |
| Approval rule | Every supplier payout needs a fresh human signature; mandates are for x402/paid-API spend only | I-4, D2 |
| Policy authority | The **Company Authority** (default: the onboarding admin; reassignable) edits policy. Loosening changes wait 24 h | C1 |

### Invariants (each must keep a passing test)
| # | Rule | Test file today |
|---|---|---|
| I-1 | No Splash key on any vault; `configAuthority` null | `tests/solana-chain-squads.test.mjs` |
| I-2 | Payout destination is the partner's one-payment deposit address (or, for CCTP, the burn's `mintRecipient`); never a Splash address | `tests/solana-chain-payout-cctp.test.mjs`, `tests/solana-chain-payout-fee.test.mjs` |
| I-3 | Kora's fee payer never sends SOL or tokens; only allowlisted programs; rent only in named rent-payer slots | `tests/solana-chain-kora.test.mjs` |
| I-4 | Every supplier payment needs a person's signature; execute without it returns 403 | `tests/solana-app-flow.test.mjs`, `tests/solana-chain-simulator.test.mjs` |
| I-5 | Memos carry the salted commitment only (`splash:v1:<hex>`) | `tests/solana-chain-payout-cctp.test.mjs` |
| I-6 | The approval card renders only deterministic fields | `components/solana/ApprovalCard.tsx` (C7 adds a unit test) |
| I-7 | Simulated receipts are labelled `simulated: true` and "Simulated" in UI | `tests/solana-chain-simulator.test.mjs` |
| I-8 (new) | A CCTP burn sets `destinationCaller` = 32 zero bytes, so either relayer (partner or Splash) can mint | add to `tests/solana-chain-payout-cctp.test.mjs` in B5 |
| I-9 (new) | Splash relayer keys (Kora signer, Polygon backup relayer, SAS attester) hold only gas money and are on the I-2 deny-list | add in B1/B5 |

## 2. What exists today (commit `86db10a` on `build/solana-colosseum`)

| Area | Files | State |
|---|---|---|
| Config | `lib/solana/config.ts` | Program ids: USDC (mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, devnet `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`), Squads V4 `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, Memo `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, CCTP V2 MessageTransmitterV2 `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC` and TokenMessengerMinterV2 `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe`, SAS `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`. Domains: Solana 5, Polygon 7. All marked unverified on-chain |
| Keys | `lib/solana/recovery-kit.ts`, `lib/solana/device-key.ts` | BIP39 24 words + SLIP-0010 `m/44'/501'/0'/0'` (official vectors pass); non-extractable WebCrypto Ed25519 in IndexedDB |
| Vault | `lib/solana/squads.ts` | Create autonomous multisig (solo/dual), proposals with ephemeral signers, approve, execute, `assertAutonomous` |
| Payout | `lib/solana/payout.ts` | ATA create (Kora pays rent), `transferChecked` + reference key, memo, optional Splash fee leg in the same vault tx |
| CCTP | `lib/solana/cctp-v2-solana.ts` | `deposit_for_burn` from the vault, event account = Squads ephemeral signer 0, destination domain 7 (Polygon) |
| Fees | `lib/solana/kora.ts`, `lib/solana/kora.toml` | Local sponsor policy mirrors the toml; JSON-RPC client (method names from Kora source @`cbef22d`) |
| Simulator | `lib/solana/simulator.ts` | Offline ledger; checks ed25519 signatures and Squads thresholds; `chain()` factory switches to devnet |
| Engine | `lib/route-engine/*` | `quoteRoutes`, policies, home-lane rule (Cheapest/Safest), 0.33% cap, `evaluatePolicy` |
| Partner | `lib/solana-partner/*` | Mock partner: quote (57.40 PHP/USD, labelled fixed), deposit addresses, HMAC webhooks |
| Evidence | `lib/solana-evidence/*` | Canonical JSON, domain-separated Merkle, memo anchor, SAS instruction builder, verifier, store |
| Zeke | `lib/solana-zeke/*` | Reader (Claude when keyed, offline otherwise; injection flag), Router (explains only), guard |
| App | `lib/solana-app/*`, `app/solana/**` (landing, onboarding, fund, pay, policy, receipts/[id], zeke), `app/api/solana/**` (18 routes), `components/solana/**` | Full offline demo; in-memory store |
| Script | `scripts/solana-devnet-e2e.ts` | Vault → faucet wait → 1 USDC payout → optional CCTP burn → `docs/solana-build/devnet-run.json`. **Never run yet** |
| Tests | `tests/solana-*.test.mjs` (106), `tests/solana-ui.e2e.mjs` (2) | `npm run test:solana` green |
| Docs | `README.md`, `docs/solana-build/{SPEC,design-brief,VIDEO}.md`, `docs/solana-build/screenshots/` (38) | Submission-ready text, pending A1 results |

**Known gaps (say them plainly in the README):** nothing has run on devnet; Squads + CCTP ephemeral event account untested on-chain; the CCTP lane needs ~0.01 SOL in the vault; Kora never called live; SAS never accepted by the deployed program; the fee account is a derived address with no key; store is in-memory; upload is text only; two-signature mode, rule editing and the Zeke chat aren't built.

---

## PART A — Submission (today → 12 Oct)

Order matters: A1 produces the evidence, A2 handles a CCTP failure, A3 updates what judges read, A4 makes `main` the front door, A5 records the video, A6 submits. Budget: about 4 hours if A1 goes cleanly.

### A1. Devnet proof run (Sky's laptop, needs internet; about 30–45 min)
**Setup (once):**
1. Node 24 if you have it; Node 22 works with `npm ci --engine-strict=false`.
2. Solana CLI installed (`solana --version`). Agave/Anza CLI 2.x is fine.
3. `git clone https://github.com/sky9484/splash-solana && cd splash-solana && git checkout build/solana-colosseum && npm ci --engine-strict=false`.
4. Throwaway devnet keypair (never reuse a real key):
   ```bash
   solana-keygen new --no-bip39-passphrase -o ~/.config/solana/splash-e2e.json
   solana airdrop 2 $(solana-keygen pubkey ~/.config/solana/splash-e2e.json) -u devnet
   ```
   If the airdrop is rate-limited, use https://faucet.solana.com (devnet, 2 SOL).

**Run 1, direct payout (no Kora yet):**
```bash
SPLASH_E2E_KEYPAIR=~/.config/solana/splash-e2e.json \
SOLANA_RPC_URL=https://api.devnet.solana.com \
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
  --import ./scripts/alias-hook.mjs scripts/solana-devnet-e2e.ts
```
5. The script creates the vault and prints the **vault USDC address**. Within 15 minutes (`SPLASH_E2E_FUND_TIMEOUT_SEC`, default 900), fund it at https://faucet.circle.com → **Solana Devnet** → USDC (10 USDC is plenty).
6. The script sends the 1 USDC payout with the memo and reference key, then writes `docs/solana-build/devnet-run.json` after every step.
7. If Squads reports a non-zero `multisigCreationFee`, the script stops. Re-run with `SPLASH_E2E_ALLOW_CREATION_FEE=1` and note the fee in the README.

**Run 2, CCTP V2 burn to Polygon Amoy:**
8. You need a Polygon Amoy address you control (any EVM wallet, testnet only).
9. ```bash
   SPLASH_E2E_KEYPAIR=~/.config/solana/splash-e2e.json \
   SPLASH_E2E_CCTP=1 SPLASH_E2E_EVM_RECIPIENT=0xYourAmoyAddress \
   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
     --import ./scripts/alias-hook.mjs scripts/solana-devnet-e2e.ts
   ```
10. After the burn, check Circle's attestation: `https://iris-api-sandbox.circle.com/v2/messages/5?transactionHash=<burn signature>`. Record `status` and the time it took to reach `complete`. **Minting on Amoy is optional for Part A** (B5 builds it); if you have Amoy POL, call `receiveMessage` on Amoy's MessageTransmitterV2 with the message and attestation and record that tx hash too.

**Commit:**
11. `git add docs/solana-build/devnet-run.json && git commit -m "Devnet run: vault, payout, CCTP burn signatures"`. Before committing, open the json and confirm it holds no private key and no words (only base58 public keys, signatures, URLs).

- **Acceptance:**
  - [ ] Vault creation signature + `assertAutonomous` passed + explorer link (`https://explorer.solana.com/tx/<sig>?cluster=devnet`).
  - [ ] Payout signature, with the memo `splash:v1:<hex>` visible on the explorer and the supplier deposit address receiving 1 USDC.
  - [ ] CCTP burn: signature + Iris `status` + attestation time, **or** the exact error recorded as "CCTP via Squads: failed on devnet because …". A recorded failure is an honest result; a missing record is not.
  - [ ] `devnet-run.json` committed, secrets-free.

### A2. If the CCTP burn fails on devnet (stop after the first fix that works)
Change one thing at a time, re-run, and record each result in `devnet-run.json` under `cctpAttempts[]`:
1. **Error mentions rent, lamports or insufficient funds for the event account:** the vault needs ~0.01 SOL for the event account's rent. Send 0.02 SOL from the e2e keypair to the vault's SOL address and re-run. (B4 removes this need later.)
2. **Error is "transaction too large" (propose + approve is 1,202 of 1,232 bytes):** split propose/approve and execute into separate transactions (`groupProposalTransactions` in `lib/solana/squads.ts`).
3. **Error says the event account must sign, or it's refused as an ephemeral signer:** try the event rent payer = the outer fee payer (the signer privilege carries into the vault's CPI). If that still fails, **stop**. Keep the CCTP route as a quoted option labelled "Test pending" and execute only the direct route in the demo. Don't hack around Circle's account rules.
- **Acceptance:** [ ] each attempt and its outcome recorded · [ ] the UI label matches the outcome ("Test pending" if CCTP didn't execute).

### A3. Update what judges read (about 45 min)
1. **README "Not verified yet":** rewrite from `devnet-run.json`. Each line is either "Verified on devnet: <what> ([tx](link))" or "Not verified yet: <what> (<why>)". Keep the CCTP line honest per A1/A2.
2. **README top:** add a "Devnet proof" box with the three explorer links under the "What is real and what is mock" note.
3. **README team line:** Sky (founder and CEO; years in banking and trade watching finance teams chase proof of payment) and Sebastian (CTO).
4. **README headline (v15.1 §14.6):** lead with founder-market fit and the paper trail, not the AI. Keep the opener: "I spent years in banking and trade watching finance teams chase proof of payment. Splash pays suppliers abroad in USDC and leaves the paper trail an auditor asks for."
5. **Screenshots:** if A1 ran on devnet, take one more screenshot of the receipt page with a real devnet signature (run the app with `SPLASH_SOLANA_MODE=devnet`). Otherwise keep the offline set.
6. Run `npm run test:solana`, `check-copy`, `check-env-reads`, `npx tsc --noEmit -p tsconfig.json`. All green, or a written reason.
- **Acceptance:** [ ] every README claim maps to a signature, a test or a "Not verified yet" line · [ ] all four commands green.

### A4. Make `main` the front door (Sky: "merge to main")
1. The remote has no `main` on 11 Oct. Create it from the submission head without rewriting history:
   ```bash
   git fetch origin
   git push origin origin/build/solana-colosseum:refs/heads/main
   ```
2. On GitHub: Settings → General → Default branch → `main`. (Only the repo owner can do this step.)
3. Keep `build/solana-colosseum` as it is (don't delete it) so the commit history judges see is intact.
4. Open the repo page logged out (or in a private window) and confirm the README renders, links work and `docs/prior-work/PRIOR_WORK.md` is reachable.
- **Acceptance:** [ ] `git ls-remote origin main` equals the A3 head · [ ] default branch shows `main` · [ ] README renders on the repo front page.

### A5. Record the 3-minute video (about 60 min)
1. Follow `docs/solana-build/VIDEO.md` line by line (0:00 → 2:40). Record at 1440 px wide, browser zoom 100%, light theme, no notifications.
2. Offline recording: keep the "Simulated · devnet-ready" label visible in every shot. Devnet recording: show the explorer link for the payout at the receipt step.
3. Say none of: licensed, gasless, any partner name, any finality number, "autonomous".
4. Export 1080p MP4, under 3:00. Upload to YouTube (unlisted) or Loom; paste the link into the README under the top box.
- **Acceptance:** [ ] video ≤ 3:00 · [ ] link in README · [ ] a second person watched it and found no banned word.

### A6. Submit on Colosseum (12 Oct)
- **Project name:** Splash.
- **One-liner:** "Pay suppliers. Prove everything."
- **Description:** the README top section (problem, three bullets, the real-vs-mock note). Don't paste anything that isn't in the README.
- **Repo:** `https://github.com/sky9484/splash-solana` (default branch `main`).
- **Video:** the A5 link. **Team:** Sky, Sebastian.
- **Prior work disclosure:** "Commit 4768824 imports our earlier Sui build as prior work; see docs/prior-work/PRIOR_WORK.md. Everything after it was built for this hackathon."
- **Acceptance:** [ ] submission confirmation saved (screenshot to `docs/solana-build/submission.png`, no personal data in it).

---

## PART B — Make it real on devnet (by 24 Oct)

### B1. Kora, run by Splash, with two-person control (Sky's answer)
**Who controls what:**
| Thing | Who | How |
|---|---|---|
| Kora fee-payer signer key | Nobody holds it by hand. It lives in a **remote key manager** (Turnkey, Privy or HashiCorp Vault; Kora's `signers.toml` supports all three, plus `memory` for local dev only) | `signers.toml` `type = "turnkey"` (preferred) with env-only credentials |
| Rotating the signer key, changing `kora.toml` policy, raising usage limits | **Splash CEO + Splash head of finance, both** | Key manager policy with a quorum of 2 for key operations; `kora.toml` changes go through a PR that needs both approvals before deploy |
| Topping up the fee payer's SOL | **Splash CEO + Splash head of finance, both** | Top-ups come only from a Splash ops **Squads 2-of-2** (CEO device + head of finance device). The fee payer itself never sends SOL anywhere |
| Reading usage and alerts | Both, plus Sebastian | Metrics endpoint + an alert when the fee payer's balance falls below 2 SOL (devnet) |

These are **Splash staff roles**, not client roles. No client person ever controls Splash's fee payer, and the fee payer is never a member of a client vault (I-1, I-9).

**Build:**
1. Deploy Kora (Solana Foundation paymaster) on a small VM or container with `lib/solana/kora.toml` and a new `lib/solana/kora.signers.example.toml` (no secrets; env names only).
2. Allowlisted programs: System (rent slots only), SPL Token, Associated Token Account, Memo, Squads V4, CCTP V2 (both programs), SAS, ComputeBudget. Allowed token: USDC only. Fee-payer policy: every `fee_payer_policy` flag false (Kora's defaults fail closed; keep it that way).
3. **Lighthouse caveat** (from Kora's own source): Lighthouse fee-payer assertions silently no-op on `signAndSendTransaction`. If you enable Lighthouse, switch `lib/solana/kora.ts` to `signTransaction` → client sends; otherwise keep `signAndSendTransaction` and rely on the fee-payer policy. Record which.
4. Auth: `KORA_API_KEY` header (and HMAC if enabled). Keys only in env and the secret store.
5. Re-read the Kora repo at the version you deploy and confirm the JSON-RPC method names in `lib/solana/kora.ts` (`getConfig`, `getPayerSigner`, `signTransaction`, `signAndSendTransaction`); fix drift; pin the Kora version in `docs/solana-build/SPEC.md`.
6. Per-org daily caps (`kora.usage_limit`) and the app's own cap in `lib/solana/kora.ts` agree; test both.
- **Acceptance:**
  - [ ] A devnet payout sponsored by Splash's Kora (signature).
  - [ ] A transaction that tries to move SOL or USDC from the fee payer is refused **by Kora itself** (record the error), not only by our local check.
  - [ ] Key-manager policy screenshot showing quorum 2 for key operations (names redacted).
  - [ ] The ops Squads 2-of-2 top-up vault exists on devnet (address in `docs/solana-build/ops.json`, public keys only) and one top-up signed by both.
  - [ ] Squads `multisigCreationFee` read on devnet and the handling documented.

### B2. Persistence
- Replace the in-memory store (`lib/solana-app/store.ts`) with Postgres through the repo's drizzle setup: tables `sol_orgs`, `sol_vaults`, `sol_members`, `sol_invoices`, `sol_payments`, `sol_payment_events`, `sol_evidence`, `sol_webhook_events` (unique on `(payment_id, status)`), `sol_cctp_messages` (unique on `(source_domain, nonce)`), `sol_policy_changes` (C1).
- Migrations in `drizzle/`; `npm run check:migrations` green. Keep an in-memory adapter behind the same interface for offline mode and tests.
- **Acceptance:** [ ] app restart keeps state · [ ] duplicate webhook rejected by the unique index (test) · [ ] offline mode still needs no database.

### B3. Evidence: SAS on devnet, Walrus + Seal
- **SAS:** a Splash attester key (remote key manager, pays fees only; I-9) creates the credential and schema once (`splash.evidence.root.v1 { root: VecU8(32), count: u32, period_start: i64, period_end: i64, sui_digest: string }`), then one attestation per batch root. Write PDAs to `docs/solana-build/sas.json`.
- **Walrus:** store each encrypted bundle through `createWalrusEvidenceStore()` → `lib/server/walrus.ts` (Splash's publisher, `permanent=true`, 53 epochs; remove `epochs: 5`). Ciphertext only.
- **Seal:** each authorised person has a reader key (non-extractable device key) mapped to a Sui address on the allowlist. Never the vault, never the recovery kit.
- Merkle leaves and root format stay identical to the Sui build's (`docs/prompts` in `sky9484/phase1`, B5) so one verifier reads both.
- Receipt page "Verify" reads the SAS attestation (devnet) and the Walrus blob id.
- **Acceptance:** [ ] one devnet receipt verifies against SAS + Walrus · [ ] tampering any field fails · [ ] `assertAttesterIsolated` test passes (the attester can't move client funds).

### B4. Remove "needs SOL" on the CCTP lane
- Use A2's result. Preferred: the Kora fee payer as `event_rent_payer` in the outer transaction (rent in a named slot, allowed by I-3; update the Kora allowlist test). Reclaim the event account rent later with Circle's `reclaim_event_account` when its window opens.
- **Acceptance:** [ ] a devnet burn from a vault holding 0 SOL · [ ] the CCTP route card says "You don't need SOL".

### B5. Polygon mint: partner relayer first, Splash relayer as backup (Sky's answer)
**Rules:**
- Every burn sets `destinationCaller` = 32 zero bytes (I-8), so anyone can submit the mint and both relayers can.
- `mintRecipient` = the partner's per-payment deposit address on Polygon (20-byte address left-padded to 32).
- Standard Transfer: `maxFee` 0, `minFinalityThreshold` 2000. Fast Transfer (Solana source supports it): read the fee from Iris `GET /v2/burn/USDC/fees/5/7` and pass it as `maxFee`; flag `fast_transfer`. Never hard-code the fee.

**Flow (`lib/solana-cctp/relay.ts` + a cron route `app/api/solana/cron/cctp-relay/route.ts`):**
1. After the burn, store `{ burnSig, sourceDomain: 5, destDomain: 7, nonce, amount, mintRecipient, partnerId }` in `sol_cctp_messages` with state `BURNED`.
2. Poll Iris `GET /v2/messages/5?transactionHash=<burnSig>` until `complete` → `ATTESTED` (store message + attestation).
3. **Partner window:** wait for the partner's signed webhook "received" or a Polygon `MintAndWithdraw` event to `mintRecipient` for that nonce. Default window: **15 minutes** after `ATTESTED` (registry field `relayWindowSec` per partner).
4. **Backup:** if nothing has landed when the window closes, the **Splash Polygon relayer** calls `receiveMessage(message, attestation)` on Polygon's MessageTransmitterV2. Before sending, check `usedNonces` on-chain: if already used, mark `MINTED_BY_OTHER` and send nothing.
5. Read the mint event: amount and recipient must equal the stored values, else `PARTIAL_EXCEPTION` for a person to resolve. On success: `MINTED_BY_PARTNER` or `MINTED_BY_SPLASH`, written to evidence.
- Splash Polygon relayer key: remote key manager, holds only POL for gas, on the I-2 deny-list (I-9). Its top-ups follow the same two-person rule as Kora (CEO + head of finance).
- Registry gains `mintsOwnCctp: boolean` and `relayWindowSec: number` per partner (sandbox values until signed).
- **Acceptance:**
  - [ ] Tests: zero `destinationCaller`; partner mints in the window → Splash sends nothing; partner silent → Splash mints once; nonce already used → no send; amount mismatch → `PARTIAL_EXCEPTION`.
  - [ ] Devnet → Amoy: one mint by the "partner" path (simulate the partner with a separate test key) and one by the Splash backup path; all signatures and tx hashes recorded.

### B6. Payout partner sandbox adapter (Sky: "sandbox")
- Keep the `PayoutPartner` interface (`lib/solana-partner/registry.ts`). Add `lib/solana-partner/noah.ts` against Noah's sandbox (`business.sandbox.noah.com`), reading docs.noah.com first: `GET channels/sell?Country=PH`, Business Customer Prefill, hosted onboarding (the Customer webhook is the source of truth, not the page's postMessage), beneficiary + payout, a per-payment deposit address on Solana (USDC token account) and on Polygon, signed webhooks; request signing required in production.
- Registry entry `{ signed: false, sandbox: true }`. UI shows "Partner sandbox" and never the partner's name (the copy guard enforces it unless `signed: true`).
- The mock stays as the offline default; `SPLASH_PARTNER=mock|noah-sandbox` selects.
- **Acceptance:** [ ] sandbox payout created, deposit address returned, webhook verified · [ ] the I-2 test covers the sandbox adapter's addresses · [ ] copy guard fails if a partner name appears in `app/` or `components/`.

### B7. Splash fee account
- A real fee account owned by a Splash Squads multisig (Splash Sdn Bhd signers: CEO + head of finance, 2-of-2). Never a client vault member. The payout fee leg pays it inside the same vault transaction.
- **Acceptance:** [ ] the I-2 deny-list includes the fee account · [ ] the fee leg amount equals the engine's `splashMinor` (test) · [ ] the fee account address in `docs/solana-build/ops.json`.

---

## PART C — Product completeness (by 31 Oct)

### C1. Two-signature mode and the Company Authority (v15.1 §14.4)
- **Dual mode:** admin device + approver device (a different director or officer from KYB) + kit A + kit B (custodians who don't approve payments), threshold 2. Switching modes is a Squads `configTransaction` that retires the old kit and adds custodian kits made on the custodians' own devices. In dual mode the payment preparer (often the accountant) and the approver (often the CEO) are different people; the app never lets one person hold both device keys.
- **Company Authority:** the highest person the company appoints (default: the onboarding admin; reassignable). Only it edits policy. Zeke can only suggest.
- **Loosening changes** (raise a limit, add an allowed supplier, add a mandate, turn off dual mode, reassign the authority): device or passkey step-up, **24-hour cooling-off**, notify all members, cancellable during the window. **Tightening:** immediate. Every change → evidence (who, what, before/after, effective time).
- Table `sol_policy_changes(id, org_id, proposed_by, proposed_via, kind, before_json, after_json, direction, step_up_at, effective_at, cancelled_at, evidence_id)`; `evaluatePolicy` reads only rows with `effective_at <= now`.
- **Acceptance:** [ ] admin alone can't execute in dual mode (test) · [ ] loosening edit not active before 24 h (fake clock) · [ ] cancel during the window works · [ ] non-authority edit rejected · [ ] a Zeke-suggested edit can't take effect without the authority.

### C2. Passkeys: LazorKit (Claude's pick, per Sky's "whichever is better")
**Why LazorKit over Swig, checked 11 Oct:**
- **LazorKit** is built around WebAuthn passkeys. Its on-chain program verifies secp256r1 (P-256) signatures. Its listing reports that the program-v2 audit by Accretion found 17 issues, all resolved before mainnet. It names a mainnet program id (`LazorjRFNavitUaBu5m3WaNPjU1maipvSW2rZfAFAKi`, verify on-chain) and already uses Kora as its paymaster.
- **Swig** was also audited by Accretion and has a stronger role and permission model, but the listing found doesn't show passkey support. For a passkey member, LazorKit fits better.

**Caveats, which are the gate:**
- LazorKit's v1 TypeScript SDK repo still says "Pre-audit. Do not use in production." Use program-v2 with an SDK version that matches it. Pin it, read it, and don't use v1.
- A LazorKit wallet is a program-owned smart wallet. To be a Squads member it must sign Squads `proposal_approve` through a CPI. That is untested.

**Build:**
1. On devnet, create a LazorKit smart wallet with a passkey, add its address as a Squads member (single mode: alongside the kit; threshold 1).
2. Approve and execute a 1 USDC payout where the passkey wallet is the approving member.
3. If step 2 works: add "Use a passkey instead of this device key" in onboarding and Settings, behind `SPLASH_PASSKEYS=lazorkit`. The recovery kit stays exactly as it is.
4. If step 2 fails: record the error, keep the WebCrypto device key, and re-check Swig's passkey support (its docs, not its listing) as plan B.
- **Acceptance:** [ ] decision and audit links in `docs/solana-build/SPEC.md` · [ ] devnet signature of a payout approved by a passkey member, **or** the recorded failure and the device key kept.

### C3. Invoice upload: PDF and image
- The Reader accepts PDF/PNG/JPG as Claude document or image content blocks with **no tools** (quarantine), model `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), zod output, every field quoting the source verbatim. The offline extractor stays for the sample invoice.
- A new or changed bank detail → "Verify by phone before paying"; payable only after `bankDetailsVerified`.
- Add `npm run eval:zeke:solana`: golden + adversarial (poisoned PDF, changed-bank-details email, prompt injection in an invoice memo, "pay now" in a chat message, a chat asking Zeke to raise a limit).
- **Acceptance:** [ ] eval shows **zero unauthorised actions** · [ ] the full account number never leaves the confirmed record (test) · [ ] eval report committed.

### C4. Zeke "Talk to your business" (draft-only, v15.1 §14.6)
| Capability | Output | Ends on |
|---|---|---|
| "Pay everything due this week" | Batch draft | One approval card (one vault transaction, or split by size) |
| "Invoice Manila Freight US$4,200 for September" | Receivable draft with a USDC payment link (Solana Pay URL to the business's vault ATA) | User presses Send |
| "Add Cebu Logistics" | Supplier invite; bank details verified out of band | Directory entry, pending verification |
| "What do we owe in pesos this month?" | Answer from payables and balances | Text only |
| "Give me September's evidence pack" | Pack + MyInvois/BIR export draft | Download |
- Rules: Zeke's tools are read-only plus `create_draft`. No tool signs, sends, edits policy or grants access. Card numbers and full account numbers never enter model context (use a beneficiary fingerprint).
- **Acceptance:** [ ] a test that the tool list has no signing, sending or policy tool · [ ] every chat draft opens the same approval card (e2e) · [ ] each row has an e2e test ending on its "Ends on" state.

### C5. Screening (threat signals)
- `lib/solana-screening/threat-signals.ts`: `check({ chain, address?, programId? }) → { level: 'none'|'low'|'high'|'unknown', source, ref, checkedAt }`, called before any transaction is built on: the deposit address or `mintRecipient`, the funding source, every program the transaction calls.
- Fail closed on `high`, and on `unknown` above US$1,000; show the reason. Wire the pay-per-check KYT vendor first; keep the stub labelled until then. Every result → evidence.
- **Acceptance:** [ ] `high` blocks with the reason shown · [ ] provider timeout → `unknown` → rule applies · [ ] stub label visible while stubbed · [ ] copy says "Screened before every payment" only after this ships.

### C6. Walk-away test (self-custody proof)
- With Splash's server off, move the vault's USDC out using only the recovery kit in the **Squads app** (single mode: kit A; dual mode: kits A + B). Record signatures in `docs/solana-build/walk-away.json`.
- Restore the kit into Phantom or Solflare and confirm the derived address matches `m/44'/501'/0'/0'`; record it.
- **Acceptance:** [ ] both signatures recorded · [ ] README walk-away line changed from "untested".

### C7. UI completion against the design brief
- Policy page: editable rules for the Company Authority, written as sentences, with the cooling-off message ("This takes effect at 14:05 tomorrow. Everyone on the account has been told."). Allowlists open their list (no hidden toggles).
- Route cards show who mints on Polygon ("Partner mints · Splash backs up") and the relay state on the progress screen (`ATTESTED` → "Circle confirmed", `MINTED_BY_*` → "Arrived at the payout partner").
- Zeke roster: add the "Data spend" mandate row only when D2 exists.
- Balance header: the total equals the sum of parts or shows "includes X pending".
- Approval card unit test for I-6 (render with a model-text field present; assert it doesn't appear).
- Accessibility: text ≥ 4.5:1, keyboard reachable, visible focus, 390 px with no horizontal scroll, reduced motion. Lighthouse a11y ≥ 95.
- **Acceptance:** [ ] `tests/solana-ui.e2e.mjs` updated and green at 1440 and 390 · [ ] screenshots refreshed · [ ] I-6 test green.

---

## PART D — Later (after October, gated)

### D1. Mainnet gate (all must be true)
- Audits listed for every third-party program used (Squads V4, Kora, CCTP V2, SAS, LazorKit if adopted); Splash's own code reviewed with `fintech-security-compliance` rigour.
- A signed payout partner (registry `signed: true`, written agreement).
- Counsel answers on K10, K13 (in-app routing and swaps) and the PH SEC wallet-provider scope.
- Walk-away test passed on devnet in both modes.
- Kora, Polygon relayer and SAS attester keys in the key manager with two-person control proven (B1 screenshots).
- Sky's explicit "go mainnet" in writing.

### D2. x402 / paid-API mandate on Solana (planned)
- Use Squads spending limits as the on-chain form of a person-signed budget: one destination, per-period cap, expiry, revocable. **Never for supplier payouts.** Same rules as the Sui `splash_mandate` (v15.1 §14.5).

### D3. Treasury (GATED; not on the Solana roadmap until counsel)
- Tokenized stocks via Treasures (treasures.io): their docs say trades are signed by the wallet that holds the funds; no KYC on secondary trading (KYC at issuer redemption); not for US persons; flat 0.1% trading fee; integrator key from hello@treasures.io. Treasures has no payables-reserve concept, so Splash adds one in policy code.
- Splash rule: a **separate treasury sub-vault**, business-signed per order, never counted in the payables reserve, never a payout source. Blocked until K17 and K18 (counsel) clear.

## 3. Commands
```bash
npm ci --engine-strict=false
npm run test:solana                      # all Solana tests (106 today)
node --test tests/solana-ui.e2e.mjs      # browser walkthrough (dev server on :3100)
npx next dev -p 3100                     # http://localhost:3100/solana
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/check-copy.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/check-env-reads.mjs
npx tsc --noEmit -p tsconfig.json
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
  --import ./scripts/alias-hook.mjs scripts/solana-devnet-e2e.ts       # A1 (env in the script header)
```

## 4. Answered by Sky (11 Oct), don't re-ask
- Payout partner signed? **No: sandbox only, never named.**
- Default branch? **Merge to `main`.**
- Kora host and keys? **Splash runs it; the key sits in a key manager; the Splash CEO and head of finance both approve rotation, top-ups and policy changes.**
- Polygon mint? **Partner relayer first, Splash relayer as backup.**
- Passkey vendor? **Claude's pick: LazorKit, gated by C2's Squads test.**

## 5. Still open: ask Sky, don't guess
- Who is Splash's head of finance (the second approver in B1/B7)? Until named, B1's quorum can't be set up.
- Which key manager: Turnkey (preferred), Privy or Vault, and whose account?
- `relayWindowSec` default: 15 minutes is a guess. Confirm, or set it from the partner's contract once signed.
