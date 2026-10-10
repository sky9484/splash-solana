# Splash — mainnet program checklist (post-demo)

Status snapshot 2026-07-18, the day before demo day. Source of truth for
"what's left": the mainnet-readiness prompt (W1–W8) + the W9/W10 addendum.
Order of work: W1 → W2 → (W3 ∥ W4) → W5 → W6 → W7 → W8; W10 alongside.

## Shipped (in review)
- [x] W9.0 type & color discipline · W9.1 quote comparison card ·
      W9.2 receipt + proof layer + share link · W9.4 money-path panel
      (collapsed) · W9.5 delivery timeline — **PR #3**
- [x] W1 PR-A: Drizzle schema (16 tables), DO Postgres client,
      double-entry ledger + CI invariant, checked-in migration — **PR #4**

## Decisions locked (2026-07-18)
- Postgres host: **DigitalOcean Managed PostgreSQL**
- W4 KYT: **stub + provider interface** until the Elliptic contract signs
- Audit: **OtterSec first** inquiry (Zellic backup) — 0xSky books
- PR #2 (IA restructure): **closed**, branch kept for post-launch

## W1 — persistence (remaining)
- [ ] PR-B: migrate stores off fs/in-memory (customer profiles, operating
      settings, seal policies, proposals/approvals, operations) onto the
      schema; delete `writeFileSync` stores; **cold-start test: pending
      approval survives a restart**
- [ ] Provision DO cluster; `DATABASE_URL` in env (0xSky)
- [ ] Restore drill executed once with evidence (docs/W1-BACKUPS.md)

## W2 — money correctness
- [ ] Sweep ~10 parseFloat/toFixed money paths to bigint minor units (lib/money/)
- [ ] Lint rule banning float math on amounts in lib/server, lib/fx
- [ ] Idempotency end-to-end (client key on every money POST, response replay,
      PTB dedupe by intent→digest)
- [ ] FX quote lifecycle: persisted quotes, hard expiry, settlement rejects expired
- [ ] Partial-failure sagas: convert-ok/payout-fail → retry → OPS_HOLD;
      payout-ok/webhook-missing → recon resolves; settle-ok/offramp-reject →
      quarantine account. Admin surface per terminal state
- [ ] Property test: same-key replay = identical result, single ledger effect

## W3 — partner rails
- [ ] Stripe `stripe-signature` + Airwallex HMAC verification; webhook_events
      inbox with unique constraint; async processing
- [ ] FX venue error taxonomy + tier routing tests (SC spot / Labuan / OTC)
- [ ] Second PH payout adapter to PDAX parity; corridor failover router; status polling
- [ ] Credential separation: sandbox vs prod namespaces; mixed-mode boot refusal
- [ ] K3 load test: 50-payout batch vs a payout-partner sandbox (needs API access)

## W4 — compliance rails (largest gap)
- [ ] KYT pipeline behind provider interface + stub: screen at beneficiary
      create, pre-settlement, inbound funding; screening_results persisted;
      risk ≥ threshold → COMPLIANCE_HOLD lane; fail closed
- [ ] KYB tier → server-enforced limits in lib/policy/evaluate.ts; middleware
      assertion on every money route
- [ ] Sanctions name screening + travel-rule data package (per payout-partner format)
- [ ] Append-only compliance artifacts, Walrus-anchored
- [ ] Swap Elliptic into the interface when contract signs (0xSky procurement)

## W5 — keys & chain
- [ ] lib/chain/signer.ts isolation; env-key impl (testnet) + KMS stub (mainnet);
      zero key reads outside the module (grep-proof)
- [ ] Key rotation runbook + one testnet rotation drill
- [ ] Mainnet config profile (network, package, native USDC via CCTP, Pyth,
      Walrus/Seal) — refuse boot on partial profile
- [ ] PTB gas headroom, typed retries, digest-before-state-advance recon
- [ ] AdminCap 2-of-3 transfer drill on testnet; upgrade policy recorded
- [ ] OtterSec audit booked (0xSky) → engagement → fixes (HARD mainnet blocker)
- [ ] Audit package prep: module inventory, specs, threat model, coverage

## W6 — controls hardening
- [ ] Maker-checker in the approval API: approver ≠ maker, distinct dual
      approvers, threshold from settings — server-asserted with tests
- [ ] Role middleware on every money + admin route (evidence table)
- [ ] Circuit breaker: trip conditions, corridor auto-pause, dual-admin re-arm,
      chaos-tested
- [ ] Velocity limits per org and corridor

## W7 — observability & reconciliation
- [ ] Correlation id = intent id through every log line; structured JSON
- [ ] Alert rules: settlement failure, webhook lag, peg deviation, partner
      error rate, cron missed, COMPLIANCE_HOLD aging
- [ ] Daily recon job: ledger ↔ chain ↔ partner statements → exceptions report
- [ ] Runbooks (stuck payment, partner outage, key compromise, peg break,
      webhook flood, DB restore) — each drilled once

## W8 — QA & launch gates
- [ ] Invariant suite in CI (money conservation, idempotency, policy bounds,
      screening-blocks-settlement)
- [ ] E2E lifecycle test on testnet: fund → convert → settle → payout → recon
- [ ] Dress rehearsal: full lifecycle through the mainnet profile mechanism
- [ ] Go/no-go: audit ✓ · AdminCap 2-of-3 ✓ · KMS ✓ · KYT fail-closed ✓ ·
      partner prod credentials ✓ · Labuan/K1 ✓ · recon zero-exception ≥5d ✓ ·
      runbooks drilled ✓ · K2/K3/K4 evidence ✓ · 0xWal evals zero banned
      assertions ✓ · injection fixtures ✓

## W9 — remaining surface
- [ ] W9.3 supplier relationship page at /dashboard/recipients (after W1 PR-B
      lands real aggregates; isOnSplash() helper — recommendation: claimed
      account)

## W10 — 0xWal intelligence
- [ ] 10.1 knowledge corpus + retrieval + claims guard on output
- [ ] 10.2 org-scoped read tools + draft-only write tools
- [ ] 10.3 persona/system prompt versioned in repo
- [ ] 10.4 MemWal allowlisted memory, visible + deletable
- [ ] 10.5 daily operating scan (cron), digest → queue drafts only
- [ ] 10.6 injection defense for extract-invoice + adversarial fixtures
- [ ] 10.7 eval harness in CI (golden/adversarial/task sets; banned-assertion
      and unauthorized-action rates must be 0)

## Standing items for 0xSky
- [ ] Send OtterSec inquiry (calendar is the August risk)
- [ ] Provision DO Postgres + DATABASE_URL
- [ ] Elliptic contract status
- [ ] Second PH payout partner: agreement signed, then sandbox access
- [ ] Review/merge PR #3 (W9) and PR #4 (W1 PR-A)
