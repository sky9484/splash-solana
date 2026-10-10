# Splash Solana build prompt (v15.1) — repo `sky9484/splash-solana`

**For:** whoever builds next (Sebastian, Sky, or a coding agent) · **Written:** 11 Oct 2026 · **Hard deadline:** Colosseum submission **12 Oct 2026**, then the October roadmap below.
**Canon:** Business Module v15.1 (locked 11 Oct 2026). Design: `docs/solana-build/design-brief.md`. Spec: `docs/solana-build/SPEC.md`. Where this prompt and canon disagree, canon wins; ask Sky before guessing.
**Paste everything below the line into Claude Code at the repo root.**

---

You are working in `sky9484/splash-solana`. It is a Next.js 16 app. Its **first commit (`4768824`) is the Sui build imported unchanged as prior work**; every later commit is the Solana build for Colosseum. Read this whole prompt before writing code. Work in the order of the parts. A task is done only when every acceptance box passes and you have pasted the evidence (command output, test names, signatures, screenshots) into the PR or the commit message.

## 0. Ground rules (non-negotiable)

1. **Read before you write.**
   - `AGENTS.md`, `CLAUDE.md`, `docs/solana-build/SPEC.md`, `docs/solana-build/design-brief.md`, `docs/prior-work/PRIOR_WORK.md`, `README.md`.
   - This Next.js version has breaking changes. Read the guide in `node_modules/next/dist/docs/` before touching routes, layouts, server components or route handlers.
2. **Load the skills** at the start and say which are missing:
   - Solana money flows: `solana-payments-engineer` (always).
   - Security: `fintech-security-compliance`, `qa-verification-engineer`.
   - Agent/finance logic: `agentic-finance-expert`, `payments-treasury-expert`, `fintech-architect`, `ai-agent-systems-architect`.
   - UI: `ui-ux-pro-max`, `isometric-typography-designer`, `frontend-design`, `design-taste-frontend` (the 11 Oct build had only `frontend-design` and `isometric-typography-designer`; run the UI through the other two when you have them).
3. **Branches.** Work on `build/solana-colosseum` until submission, then one branch per part (`sol/<part>`). Never force-push. Sky or Sebastian merges.
4. **Colosseum honesty.**
   - Only work done between 14 Sep and 12 Oct 2026 is judged. Commit `4768824` is prior work and stays labelled so. Never squash it into Solana commits.
   - Never claim a devnet result that doesn't have a signature in `docs/solana-build/devnet-run.json`.
   - "Simulated · devnet-ready" stays on every screen and receipt produced offline.
5. **Claims discipline in every string a user or judge can read.**
   - Never: "licensed" (about Splash or a partner), yield, APY, escrow, netting, "gasless", "autonomous", "guaranteed", "instant", any finality number.
   - Never name a payout partner in UI or video. Say "payout partner"; the mock is "Mock partner · devnet".
   - Say "You don't need SOL" only on the Solana direct route. The CCTP route says "Needs 0.01 SOL in the vault (test pending)" until Part B4 removes the need.
   - Approved sentences: "Splash never holds the money." · "Your vault, your keys." · "Zeke drafts. A person approves."
   - `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/check-copy.mjs` must pass.
6. **Secrets.** The 24 words and the device private key exist only in the browser. No mnemonic, private key or API key in the repo, logs, analytics, Walrus or test fixtures (generate throwaway keys inside tests). `docs/solana-build/devnet-run.json` holds public keys and signatures only.
7. **Money.** bigint minor units everywhere (USDC 6 decimals, PHP centavos). Use `lib/money.ts`. No floats on money.
8. **Run mode.** `SPLASH_SOLANA_MODE=offline` (default) touches no network. `devnet` uses `SOLANA_RPC_URL`, `KORA_RPC_URL`, `KORA_API_KEY`. Mainnet is refused by `readSolanaEnv` and stays refused until Part D's mainnet gate.

## 1. What this build is (keep it in your head)

Splash is **self-custodial settlement software**. A Malaysian business pays a Philippine supplier's invoice in USDC on Solana:
- the business holds its own **autonomous Squads V4 vault** (device key + recovery kit; `configAuthority` null; no Splash member);
- **Zeke** reads the invoice in quarantine and explains routes; it can only draft;
- the **route engine** ranks Solana direct against a CCTP V2 burn to the partner's Polygon address by **pesos the supplier receives**;
- **policy runs as code**; **a person signs** with the device key; **Kora** pays the network fee;
- a **payout partner of record** (mock today) pays the supplier's bank;
- every payment leaves an **evidence bundle** whose Merkle root is anchored on Solana (SPL Memo now, SAS next).

### Invariants (each must keep a passing test)
| # | Rule | Test file today |
|---|---|---|
| I-1 | No Splash key on any vault; `configAuthority` null | `tests/solana-chain-squads.test.mjs` |
| I-2 | Payout destination is the partner's one-payment deposit address (or the burn's `mintRecipient`); never a Splash address | `tests/solana-chain-payout-cctp.test.mjs`, `tests/solana-chain-payout-fee.test.mjs` |
| I-3 | Kora's fee payer never sends SOL or tokens; only allowlisted programs; rent only in named rent-payer slots | `tests/solana-chain-kora.test.mjs` |
| I-4 | Every supplier payment needs a person's signature; execute without it returns 403 | `tests/solana-app-flow.test.mjs`, `tests/solana-chain-simulator.test.mjs` |
| I-5 | Memos carry the salted commitment only (`splash:v1:<hex>`) | `tests/solana-chain-payout-cctp.test.mjs` |
| I-6 | The approval card renders only deterministic fields | `components/solana/ApprovalCard.tsx` (add a unit test in Part C) |
| I-7 | Simulated receipts are labelled `simulated: true` and "Simulated" in UI | `tests/solana-chain-simulator.test.mjs` |

## 2. What exists today (commit `5ea6677`)

| Area | Files | State |
|---|---|---|
| Config | `lib/solana/config.ts` | Program ids for USDC, Squads V4, Memo, CCTP V2 (MessageTransmitterV2 `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC`, TokenMessengerMinterV2 `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe`), SAS `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`. All marked unverified on-chain |
| Keys | `lib/solana/recovery-kit.ts`, `lib/solana/device-key.ts` | BIP39 + SLIP-0010 (official vectors pass); non-extractable WebCrypto Ed25519 |
| Vault | `lib/solana/squads.ts` | Create autonomous multisig (solo/dual), proposals with ephemeral signers, approve, execute, `assertAutonomous` |
| Payout | `lib/solana/payout.ts` | ATA create (Kora pays rent), `transferChecked` + reference key, memo, optional Splash fee leg in the same vault tx |
| CCTP | `lib/solana/cctp-v2-solana.ts` | `deposit_for_burn` from the vault, event account = Squads ephemeral signer 0, domain 7 (Polygon) |
| Fees | `lib/solana/kora.ts`, `lib/solana/kora.toml` | Local sponsor policy mirrors the toml; JSON-RPC client (method names from Kora source @cbef22d) |
| Simulator | `lib/solana/simulator.ts` | Offline ledger; checks ed25519 signatures and Squads thresholds; `chain()` factory switches to devnet |
| Engine | `lib/route-engine/*` | `quoteRoutes`, policies, home-lane rule (Cheapest/Safest), 0.33% cap, `evaluatePolicy` |
| Partner | `lib/solana-partner/*` | Mock partner: quote (57.40 PHP/USD, labelled), deposit addresses, HMAC webhooks |
| Evidence | `lib/solana-evidence/*` | Canonical JSON, domain-separated Merkle, memo anchor, SAS instruction builder, verifier |
| Zeke | `lib/solana-zeke/*` | Reader (Claude when keyed, offline otherwise; injection flag), Router (explains only), guard |
| App | `lib/solana-app/*`, `app/solana/**`, `app/api/solana/**`, `components/solana/**` | Full offline demo; in-memory store; 18 API routes |
| Script | `scripts/solana-devnet-e2e.ts` | Vault → faucet wait → 1 USDC payout → optional CCTP burn → `docs/solana-build/devnet-run.json` |
| Tests | `tests/solana-*.test.mjs` (106), `tests/solana-ui.e2e.mjs` (2) | `npm run test:solana` |

**Known gaps (be honest about them in README):** nothing has run on devnet; Squads + CCTP ephemeral event account untested on-chain; the CCTP lane needs ~0.01 SOL in the vault; Kora never called live; SAS never accepted by the deployed program; the fee account is a derived address with no key; store is in-memory; upload is text only; two-signature mode, rule editing and the Zeke chat are not built.

---

## PART A — Before submission (today and 12 Oct)

### A1. Devnet proof run (Sky's laptop, needs internet)
1. `npm ci --engine-strict=false` (repo pins Node 24; Node 22 works).
2. Create a throwaway devnet keypair: `solana-keygen new -o ~/.config/splash-e2e.json` and airdrop 2 SOL (`solana airdrop 2 --url devnet`).
3. Run the script per its header, e.g.:
   ```bash
   SPLASH_E2E_KEYPAIR=~/.config/splash-e2e.json \
   SOLANA_RPC_URL=https://api.devnet.solana.com \
   npx tsx scripts/solana-devnet-e2e.ts
   ```
   (If `tsx` isn't installed, use `node --experimental-strip-types --import ./scripts/alias-hook.mjs scripts/solana-devnet-e2e.ts`.)
4. When it prints the vault USDC address, fund it at https://faucet.circle.com (Solana Devnet, USDC).
5. Let it send the 1 USDC payout. Then re-run with `SPLASH_E2E_CCTP=1 SPLASH_E2E_EVM_RECIPIENT=<your Polygon Amoy address>` for the burn.
6. Commit `docs/solana-build/devnet-run.json`.
- **Acceptance:**
  - [ ] Vault creation signature, `assertAutonomous` passed, explorer link.
  - [ ] Payout signature with the memo visible on the explorer (`splash:v1:<hex>`).
  - [ ] CCTP burn: signature + Iris message status, or the exact error recorded as "CCTP via Squads: failed on devnet because …" (that is an honest result too).
  - [ ] README "Not verified yet" list updated to match what passed.

### A2. If the CCTP burn fails on devnet
Try in this order, one change at a time, and record each result:
1. **Event rent payer = Kora fee payer** (outer signer; signer privilege carries into the vault CPI). This is rent in a named slot, allowed by I-3's rent rule; update the Kora allowlist test.
2. Split propose/approve and execute into separate transactions (`groupProposalTransactions`), if the failure is size (propose + approve is 1,202 of 1,232 bytes).
3. If the ephemeral signer is refused as the event account, stop: keep the CCTP route as a quoted option labelled "Test pending" and execute only the direct route in the demo. Don't hack around Circle's account rules.

### A3. README, video, submission
- Replace the "Not verified yet" section with the A1 results; add explorer links.
- Record the 3-minute video from `docs/solana-build/VIDEO.md` (offline or devnet; keep the Simulated label if offline).
- Submission text: the 100-word copy in `README.md` top section. Team: Sky (founder, banking and trade background) and Sebastian (CTO).
- Repo: confirm the default branch on GitHub shows the README (set `build/solana-colosseum` as default or merge to `main`).
- **Acceptance:** [ ] `npm run test:solana` green · [ ] `check-copy` green · [ ] video uploaded · [ ] README links work.

---

## PART B — Make it real on devnet (by 24 Oct)

### B1. Kora, self-hosted
- Deploy Kora (Solana Foundation fee relayer) with `lib/solana/kora.toml`: allowlisted programs System (rent slots only), SPL Token, ATA, Memo, Squads V4, CCTP V2 (both), SAS, ComputeBudget; per-org daily caps; refuse any instruction moving SOL or tokens from the fee payer.
- Read the Kora repo at the version you deploy and confirm the JSON-RPC method names used in `lib/solana/kora.ts` (`getConfig`, `getPayerSigner`, `signTransaction`, `signAndSendTransaction`); fix any drift.
- Auth: `KORA_API_KEY` header (and HMAC if enabled). Keys only in env.
- **Acceptance:**
  - [ ] A devnet payout sponsored by your Kora (signature).
  - [ ] A transaction that tries to move SOL from the fee payer is refused by Kora itself (not only by our local check); record the error.
  - [ ] Squads `multisigCreationFee` read on devnet; if > 0, the fee is paid by the vault creator in a named rent slot or the creation path is changed; document which.

### B2. Persistence
- Replace the in-memory store (`lib/solana-app/store.ts`) with Postgres through the existing drizzle setup: tables `sol_orgs`, `sol_vaults`, `sol_members`, `sol_invoices`, `sol_payments`, `sol_payment_events`, `sol_evidence`, `sol_webhook_events` (unique on `(payment_id, status)` for dedupe).
- Migrations in `drizzle/`; `npm run check:migrations` green.
- **Acceptance:** [ ] App restart keeps state · [ ] duplicate webhook rejected by the unique index (test).

### B3. Evidence: SAS on devnet, Walrus + Seal
- **SAS:** a Splash attester key (env, pays fees only) creates the credential and schema once (`splash.evidence.root.v1 { root: bytes32 as VecU8(32), count: u32, period_start: i64, period_end: i64, sui_digest: string }`), then one attestation per batch root. Write the PDAs to `docs/solana-build/sas.json`.
- **Walrus:** store each encrypted bundle via `createWalrusEvidenceStore()` → `lib/server/walrus.ts` (Splash's publisher, `permanent=true`, 53 epochs; remove `epochs: 5`). Ciphertext only.
- **Seal:** each authorised person has a reader key (non-extractable device key) mapped to a Sui address on the allowlist. Never the vault, never the recovery kit.
- Receipt page "Verify" reads the SAS attestation (devnet) and the Walrus blob id.
- **Acceptance:** [ ] One devnet receipt verifies against SAS + Walrus · [ ] tampering fails · [ ] `assertAttesterIsolated` test passes (attester can't move client funds).

### B4. Remove "needs SOL" on the CCTP lane
- Use the A2 result. Preferred: Kora fee payer as `event_rent_payer` in the outer transaction. Reclaim the event account rent later with Circle's `reclaim_event_account` when available.
- **Acceptance:** [ ] a devnet burn from a vault with 0 SOL · [ ] route card copy changes to "You don't need SOL" for the CCTP route.

### B5. Polygon side of CCTP
- Decide who mints on Polygon: the partner's own relayer, Circle's Forwarding Service on Polygon (check Circle's supported-chains table for Polygon as a Forwarding destination), or a Splash relayer. Record the decision in `docs/solana-build/SPEC.md`.
- Fast Transfer: read the fee from `GET /v2/burn/USDC/fees/{sourceDomainId}/{destDomainId}` (Circle Iris) and pass it as `maxFee`; flag `fast_transfer`.
- **Acceptance:** [ ] devnet Solana → Polygon Amoy mint completed (both signatures) · [ ] fee read from Circle, not hard-coded.

### B6. Real payout partner adapter (sandbox)
- Keep `PayoutPartner` interface. Add `lib/solana-partner/noah.ts` against Noah's sandbox (`business.sandbox.noah.com`): `GET channels/sell?Country=PH`, Business Customer Prefill, hosted onboarding, beneficiary + payout, per-payment Solana deposit address, signed webhooks (request signing in production).
- Registry entry `signed: false`, `sandbox: true`. UI still says "payout partner" until Sky confirms a signed agreement.
- **Acceptance:** [ ] sandbox payout created; deposit address returned; webhook verified · [ ] I-2 test covers the real adapter.

### B7. Splash fee account
- A real fee account owned by a Splash Squads multisig (Splash Sdn Bhd signers). Never a client vault member. The payout fee leg sends there inside the same vault transaction.
- **Acceptance:** [ ] I-2 deny-list includes the fee account · [ ] fee leg amount equals the engine's `splashMinor`.

---

## PART C — Product completeness (by 31 Oct)

### C1. Two-signature mode and the Company Authority (v15.1 §14.4)
- Dual mode: admin device + approver device (a different director from KYB) + kit A + kit B (custodians, not approvers), threshold 2. Switching modes is a Squads `configTransaction` that retires the old kit and adds custodian kits made on custodians' devices.
- **Company Authority** = the highest person the company appoints (default: onboarding admin; reassignable). Only it edits policy. Zeke can only propose.
- Loosening changes (raise a limit, add an allowed supplier, add a mandate, turn off dual mode, reassign the authority): passkey/device step-up, **24-hour cooling-off**, notify all members. Tightening: immediate. Every change into evidence (before/after).
- **Acceptance:** [ ] admin alone can't execute in dual mode (test) · [ ] loosening edit not active before 24 h (test with a fake clock) · [ ] non-authority edit rejected · [ ] Zeke-originated edit impossible.

### C2. Passkeys (upgrade from device keys)
- Evaluate Swig and LazorKit as a Squads V4 member (secp256r1 precompile). Pick one only if it is audited and works on devnet with Squads; else keep the device key.
- **Acceptance:** [ ] decision recorded with audit links · [ ] if adopted, a devnet payout signed by a passkey member.

### C3. Invoice upload: PDF and image
- Reader accepts PDF/PNG/JPG as Claude document/image content blocks with **no tools** (quarantine), model `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), zod output, each field quoting the source verbatim. Offline extractor stays for the sample.
- New or changed bank details → "Verify by phone before paying"; payable only after `bankDetailsVerified`.
- **Acceptance:** [ ] eval set: poisoned PDF, changed-bank-details email, prompt injection in a memo → zero unauthorised actions (`npm run eval:zeke:solana`) · [ ] full account number never leaves the confirmed record (test).

### C4. Zeke "Talk to your business" (draft-only capability roadmap, v15.1 §14.6)
| Capability | Output | Ends on |
|---|---|---|
| "Pay everything due this week" | Batch draft | Approval card (one approval, one vault transaction or split by size) |
| "Invoice Manila Freight US$4,200 for September" | Receivable draft with a USDC payment link (Solana Pay URL to the business's vault ATA) | User presses Send |
| "Add Cebu Logistics" | Supplier invite; bank details verified out of band | Directory entry pending verification |
| "What do we owe in pesos this month?" | Answer from payables and balances | Text only |
| "Give me September's evidence pack" | Pack + MyInvois/BIR export draft | Download |
- Rules: Zeke tools are read-only plus `create_draft`; no tool signs, sends, edits policy or grants access. Card numbers and full account numbers never enter model context (use a beneficiary fingerprint).
- **Acceptance:** [ ] a test that the tool list has no signing/sending/policy tool · [ ] every chat draft opens the same approval card.

### C5. Screening (threat signals)
- `lib/solana-screening/threat-signals.ts`: `check({ address | programId, chain }) → { level: 'none'|'low'|'high', source, ref }`, behind the policy gate. Fail closed on `high`. Wire the pay-per-check KYT vendor first; keep the stub labelled until then.
- Every result into evidence.
- **Acceptance:** [ ] `high` blocks with the reason shown · [ ] stub label visible when stubbed.

### C6. Walk-away test (self-custody proof)
- With Splash's server off, move the vault's USDC out using only the recovery kit in the **Squads app** (single mode: kit A; dual mode: kits A + B). Record the signatures in `docs/solana-build/walk-away.json`.
- Restore the kit into Phantom or Solflare and confirm the derived address matches `m/44'/501'/0'/0'`; record it.
- **Acceptance:** [ ] both signatures recorded · [ ] README walk-away line updated from "untested".

### C7. UI completion against the design brief
- Policy page: editable rules for the Company Authority with the cooling-off message; allowlists open their list (no hidden toggles).
- Zeke roster: add the "Data spend" mandate row only when Part D2 exists.
- Balance header: total equals the sum of parts or shows "includes X pending".
- Accessibility: ≥ 4.5:1 text, keyboard reachable, visible focus, 390 px, reduced motion. Lighthouse a11y ≥ 95.
- **Acceptance:** [ ] `tests/solana-ui.e2e.mjs` updated and green at 1440 and 390 · [ ] screenshots refreshed.

---

## PART D — Later (post-October, gated)

### D1. Mainnet gate (all must be true)
- Audits listed for every third-party program used (Squads V4, Kora, CCTP V2, SAS); Splash's own code reviewed with `sui-security-auditor`-equivalent rigour for TS (`fintech-security-compliance`).
- A signed payout partner (registry `signed: true`, written agreement).
- Counsel answers on K10, K13 (in-app routing/swaps), PH SEC wallet-provider scope.
- Walk-away test passed on devnet in both modes.
- Sky's explicit "go mainnet" in writing.

### D2. x402 / paid-API mandate on Solana (planned)
- Use Squads spending limits as the on-chain form of a person-signed budget: one destination, per-period cap, expiry, revocable. **Never for supplier payouts.** Same rules as the Sui `splash_mandate`.

### D3. Treasury (GATED; not on the Solana roadmap until counsel)
- Tokenized stocks via Treasures (treasures.io): their docs say trades are signed by the wallet that holds the funds, no KYC on secondary trading (KYC at issuer redemption), not available to US persons, flat 0.1% trading fee, integrator key from hello@treasures.io. Splash rule: a **separate treasury sub-vault**, business-signed per order, never counted in the payables reserve, never a payout source. Blocked until K17 and K18 (counsel) clear.

## 3. Commands
```bash
npm ci --engine-strict=false
npm run test:solana                      # all Solana tests
node --test tests/solana-ui.e2e.mjs      # browser walkthrough (dev server on :3100)
npx next dev -p 3100                     # http://localhost:3100/solana
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/check-copy.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/check-env-reads.mjs
npx tsc --noEmit -p tsconfig.json
```

## 4. Ask Sky, don't guess
- Is a payout partner signed? (Until yes: mock or sandbox only, never named.)
- Default branch: `build/solana-colosseum` or merge to `main`?
- Which Kora host and who holds its keys?
- Polygon mint: partner relayer, Circle forwarding, or Splash relayer?
- Passkey vendor choice (Swig or LazorKit) after the audit check.
