# Changes

## Solana build (prompt 07, "Solana everywhere, proof on Walrus")

Each phase is one PR into `sol/b0-solana-everywhere`; decisions are in `docs/solana-build/DECISIONS.md`.

### Phase 0 · inventory (#1)
- Classified every Sui hit (`docs/solana-build/SUI-REMOVAL.md`): delete, keep as evidence, or rewrite. Mapped the `/solana` demo routes into the dashboard.

### Phase 1 · sign-in and setup (#3)
- Sign-in is email and password, or Google; neither holds a key. zkLogin is deleted.
- Account setup makes a 24-word recovery kit and a non-extractable device key in the browser, then a Squads V4 vault with no config authority, in one request. The passkey is a sign-in check only.

### Phase 2 · evidence isolated (#4)
- `lib/evidence-sui/` is the only code that imports `@mysten/*` (an ESLint rule and a test). Sui settlement is deleted.
- The Seal allowlist Move package is written and tested; it is not published (gate G1).

### Phase 3 · the money path (#5)
- Payments are a durable state machine with compare-and-set in `solana_payments`. Every chain call is recorded before it is broadcast; a crash resumes by polling, never by resending.
- Rules: launch scope, KYB, terms, limits, duplicate invoice, bank details verified, screening (stub). Kora gets a per-company daily cap.
- Batch payouts are chunked by measured transaction size. The fee is 0.10% per payout, US$2 minimum (D-P3-2).
- A LiteSVM suite (skips loudly without its binding) and a devnet proof script.

### Phase 4 · every screen on Solana (#6)
- Every payment can be traced on Solscan: the memo `splash:pay:v1:<id>` and each transaction and account (D-P4-1).
- `/api/solana` acts for the signed-in company only; its records are durable documents (D-P4-2). The demo moved into the dashboard; old URLs answer 308.
- Batch payouts on Solana: measured chunks, one approval, retried chunk by chunk (D-P4-3).
- The landing tells the Solana story. Lighthouse accessibility is 100 at desktop and mobile.
- Invoices (the loop: read, checked, approved, paid, proof anchored), Transfer (no invoice), and Treasury (vault #1, moved to the payments vault with one approval) (D-P4-4).
- The §9 checks: claims, no Sui on any screen, integer money.

### Phase 5 · the staff console (#7)
- Six sections:
  - orgs and vaults, with the config authority read from the chain;
  - payments;
  - the fee payer, with spend counted to the lamport (migration 0032);
  - evidence;
  - refuse service, with a reason and an audit log;
  - partner webhooks, each with its signature check (D-P5-1).
- A suspended company gets no fee-payer signature from any code path.

### Phase 6 · trust and docs
- /trust covers:
  - who holds what: the business holds its vaults and keys; Splash's three keys cannot move a customer's money;
  - what Splash can and cannot do;
  - the regulated roles, none signed yet;
  - the licensing path;
  - how each payment's record is kept.
- The README gains a real-vs-mock table, Node 24 run steps and the "Not verified yet" list.
- `STATUS.md` now describes the Solana build. The Sui build's status moved to `docs/prior-work/`.

---

# Phase 1 Upgrade Log (the Sui build, prior work)

## P0-1

- Added the shared Phase 1 domain store, transfer audit history, delivery tiers,
  invoices, ledger entries, sweep jobs, rate holds, and demo seed model.
- Added the mock AES-GCM Seal adapter with access policies and a fail-closed live
  adapter placeholder.

## P0-2

- Rebuilt the Walrus adapter with ciphertext-only validation, mock round-trip
  storage, live publisher/aggregator support, and typed network failures.

## P0-3 / P0-4

- Added validated invoice APIs, Seal + Walrus document flow, a live invoice
  vault, secure pay-link creation, and issuer settlement confirmation.
- Added the public bank-transfer payment request and counterparty acquisition
  flow with payer recipient creation, KYB-invite stub, and analytics summary.

## P0-5 / P0-6

- Added the three-rung recipient delivery ladder to the send wizard and persisted
  the selected delivery tier through authorization.
- Added the PDAX adapter, settlement-completion sweep engine, stored-balance
  credits, paired ledger entries, and held-duration API fields.

## P0-7

- Added the five-panel 0xWal invoice-to-payment workspace, access checks,
  extraction recommendation route, invoice-prefilled transfer handoff, and chat link.

## P0-8

- Added linked audit-trail views with Walrus retrieval, Seal decryption, document
  hash verification, Seal allowlist and extraction evidence, Sui proof, sweep proof,
  and full status history.

## P0-9

- Added the compliance-copy CI guard, removed hardcoded visible treasury-rate
  defaults, removed the static nav yield badge, and made treasury execution fail
  closed in both the API and interface with the required projection disclosure.

## P0-10

- Completed the exact demo dataset across invoices, all three recipient tiers,
  completed swept transfer and audit chain, Cebu stored balance, and active PHP
  rate hold; wired recipients to the live store and applied DEMO badges.

## P1-1

- Added privacy-bounded MemWal behavior recall cards to the operating desk and
  0xWal workspace, with safe demo behavior seeds and no PII-bearing memories.

## P1-2

- Added live open-invoice batch recommendations to 0xWal, with corridor-aware
  savings estimates and one-click pre-staging in the batch compliance desk.

## P1-3

- Added server-owned 48-hour rate holds, an active-hold countdown desk, and a
  quote-step workflow that creates and reuses a selected hold with authorization.

## P1-4

- Replaced the dashboard's first generic metric with a live 0xWal operating
  summary for detected invoices, same-corridor batchability, and approval work.

## P1-5

- Added full-store CSV and JSON reconciliation exports with deterministic
  accounting fields and dated `splash-reconciliation-{yyyymmdd}` filenames.

## P1-6

- Added a $5,000 sweep-versus-hold simulator that separates fees removed by
  internal netting from fees relocated to the eventual external payout.

## QA

- Deduplicated MemWal recall cards and safely backfilled missing behavior slots
  to prevent duplicate React keys in the operating desk.
- Moved corridor batch prefill behind the initial render to keep server and
  client summary counts identical while preserving one-click batch staging.
- Added a client-side MemWal normalization boundary so repeated or malformed
  recalled behaviors cannot create duplicate React keys or duplicate cards.
