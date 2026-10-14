# Splash on Solana

**Pay suppliers. Prove everything.**

Every month, finance teams across Southeast Asia pay suppliers abroad, then spend days proving it: the invoice in email, the approval in WhatsApp, the rate in a screenshot. Splash pays the supplier in USDC on Solana and keeps one record of the whole payment: invoice, approval, transfer and rate.

- **Your vault, your keys.** Every business gets its own Squads V4 vault with no config authority. Splash holds no key that can move the money.
- **AI that works, never spends.** Zeke reads the invoice and compares routes. A person signs every payment.
- **One record per payment.** The evidence record is hashed into a Merkle root and anchored on Solana, and anyone holding the receipt can verify it.

Built for Colosseum (submission 12 Oct 2026). First corridor: Malaysia to the Philippines.

## What's real and what's mock

| Part | Status |
|---|---|
| Vault (Squads V4, no config authority), device keys, recovery kit | **Real code.** Runs on devnet; offline, a simulator checks every signature and threshold. |
| Payments, transfers, batches, treasury moves, the rules, route ranking | **Real code** with tests. One path for invoices, transfers and batches. |
| Fees in SOL (Kora fee payer) | **Real code.** The allowlist, per-company cap and spend ledger are tested; it has not run against a live Kora (see below). |
| Evidence (bundle, Merkle root, Solana anchor, receipt verify) | **Real code.** Anchored by SPL Memo; the attestation service schema is not live yet. |
| Evidence storage and encryption (Walrus, Seal) | **Real adapters.** Offline, a stand-in store seals records with a server key and says so. |
| **Payout partner** | **Mock** ("Mock partner · devnet"): its peso rate is a fixed reference, not a live rate, and it pays no real bank. It stays a mock until a sandbox agreement is approved. |
| Wallet screening (KYT) | **Stub**, labelled as such on every approval card and funds check. |
| Funding from outside the vaults (bank or card top-ups, USDT or PYUSD swapped to USDC) | **Sandbox stand-ins**, labelled so on every screen: offline they credit the payments vault after a simulated funds check, and their charges are sandbox estimates. No agreement with any provider is signed. |
| Treasury investments (T-bills via Ondo's USDY, US stocks and ETFs via Ondo) | **Test mode only**, until legal sign-off in Malaysia: orders are approved on a device and settled by a simulator. Every rate and past return is dated and sourced (`lib/treasury/reference.ts`). See `docs/solana-build/TREASURY.md`. |
| The run mode | **Offline by default**: every screen and receipt says "Test mode". The same code runs on devnet with `SPLASH_SOLANA_MODE=devnet`. |

## The problem
- The World Bank's Remittance Prices Worldwide puts the average cost of sending money from Malaysia to the Philippines at **3.92%**, with banks charging **up to 9.56%** and **1.49%** hidden in the exchange rate (Q3 2025, US$200 and US$500 sends; retail prices, so a floor for business payments).
- The Philippines makes compliant e-invoices mandatory on or before 31 Dec 2026 (BIR RMC 098-2026). Every supplier payment will need to match an invoice.

## The flow (one payment, end to end)
1. **Onboard.** Sign in (email and password, or Google; neither holds a key) → account setup: a recovery kit of 24 words made in the browser (BIP39, SLIP-0010 `m/44'/501'/0'/0'`) → a non-extractable WebCrypto Ed25519 device key → a **Squads V4 vault with no config authority** (members: device key + kit, threshold 1, `configAuthority` null). The server only ever sees public keys and proof-of-possession signatures.
2. **Fund.** USDC to the payments vault: moved in from the company's **treasury** (vault #1 of the same multisig, one device approval, memo `splash:move:v1:<id>`, no Splash fee), or sent from any Solana wallet (devnet: Circle's faucet).
3. **Invoice.** Zeke's Reader extracts the fields in quarantine (no tools; document text is data, injected instructions are flagged). A person confirms every field. A new bank detail can't be paid until it is verified out of band.
4. **Quote.** The engine compares **Solana direct** to the partner's one-payment deposit address with a **CCTP V2 burn on Solana minting at the partner's Polygon address**, and ranks them by **pesos the supplier receives**: Cheapest, Shortest route, Safest. Zeke explains; it can't change a route.
5. **Policy.** Deterministic checks: tier limits, per-payment cap, screening (stub), duplicate invoice, quote expiry, bank details verified.
6. **Approve.** The approval card is built only from confirmed fields and the quote, never from model text. The device key signs the Squads proposal and approval; the vault executes. **Kora** pays the network fee, so the business doesn't need SOL on the direct route.
7. **Deliver.** The mock partner sends HMAC-signed webhooks: received, then paid with a bank reference.
8. **Prove.** A kind-3 evidence bundle (invoice commitment, approval chain, quoted vs executed route, signatures, FX rate, bank reference) is hashed into a Merkle root and anchored with an SPL Memo, or a Solana Attestation Service attestation. The receipt page re-verifies it, and fails when any field is tampered with.

The same path pays a **transfer** with no invoice (Dashboard → Transfer), in five steps: Beneficiary, Delivery, Quote & Send, Status, Receipt. A new recipient still needs a call-back. Quote & Send asks what the payout partner needs (purchase of goods or of services, the relationship, where the money comes from, and, the first time, who the recipient is; next time, "Same details as before?"). Then it asks how you pay: from your vaults (ready now, topped up from the treasury in place), or USD or a stablecoin brought into the payments vault from outside first, after a funds check and a declaration. From the approval on, it is steps 6 to 8 unchanged. Invoices show where each one is on the loop (read by Zeke, checked by a person, approved on a device, paid to the bank, proof anchored).

## Architecture

| Layer | Choice | Where |
|---|---|---|
| Identity | App sign-in only; it never holds a key | — |
| Daily signer | WebCrypto Ed25519, non-extractable, in IndexedDB | `lib/solana/device-key.ts` |
| Recovery | 24-word kit made on the device; walk-away with the Squads app | `lib/solana/recovery-kit.ts` |
| Wallet | Squads V4 multisig per business, no config authority | `lib/solana/squads.ts` |
| Asset | Native USDC (classic SPL, not Token-2022) | `lib/solana/config.ts` |
| Payment reference | SPL Memo with a Splash id only (`splash:pay:v1:<id>`, `splash:move:v1:<id>`), never a name or invoice number | `lib/solana/payout.ts` |
| Treasury | Vault #1 of the same multisig (operating cash); a move to vault #0 is one device approval | `lib/solana-app/treasury-service.ts` |
| Fees | Kora fee payer; allowlisted programs; it never sends SOL or tokens | `lib/solana/kora.ts`, `kora.toml` |
| Cross-chain | CCTP V2 burn from the vault (event account = Squads ephemeral signer) | `lib/solana/cctp-v2-solana.ts` |
| Engine | Ranked by local currency received; home-lane rule; 0.33% all-in target | `lib/route-engine/` |
| Evidence | Canonical JSON, domain-separated Merkle tree, Memo or SAS anchor | `lib/solana-evidence/` |
| Agent | Zeke: quarantined Reader, explaining Router, no signing functions | `lib/solana-zeke/` |
| App | The signed-in dashboard (`/dashboard`: Invoices, Transfer, Batch, Treasury, Zeke), a public auditor receipt (`/receipt/<token>`), the staff console (`/admin`) | `app/dashboard/`, `app/admin/`, `lib/solana-app/` |

**Invariants (each has a test):**
- Splash holds no key on any vault, and `configAuthority` is null (the staff console reads it from the chain).
- A payout goes only to the partner's deposit address; a move goes only to the company's other vault.
- The fee payer never moves SOL or tokens, and what it spends is counted to the lamport.
- Every payment and move needs a person's signature; an execute without it returns 403.
- A suspended company gets no fee-payer signature from any code path.
- Memos carry only a Splash id.
- The approval card renders only deterministic fields.
- Simulated receipts are always labelled.

## Run it

Node 24 (the repo pins `24.11.1` in `.nvmrc`; `engines` asks for `>=24.11 <25`) and npm 11.

```bash
nvm use            # or: fnm use / volta, any manager that reads .nvmrc
npm ci
npm run dev:db     # terminal 1: Postgres in memory on 127.0.0.1:5433, migrated, with three demo companies
```

```bash
# terminal 2: the app, offline (the chain simulator; nothing touches a network)
DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres?sslmode=disable SPLASH_SOLANA_MODE=offline npm run dev
```

Open http://localhost:3000/login and sign in as `demo@acme.test`; the password is `DEMO_PASSWORD` in `scripts/dev-db.mjs`. Account setup makes the recovery kit, the device key and the vault in your browser. Then: Treasury → add test USDC and move some to the payments vault → Invoices → the sample invoice. The staff console is at `/admin/login` (dev login in `lib/server/admin-auth.ts`, or set `ADMIN_EMAIL` / `ADMIN_PASSWORD`).

For devnet:

```bash
SPLASH_SOLANA_MODE=devnet SOLANA_RPC_URL=https://api.devnet.solana.com \
KORA_RPC_URL=<your Kora> KORA_API_KEY=<key> npx next dev -p 3100
```

**Real devnet signatures:** `scripts/solana-devnet-e2e.ts` creates a vault, waits for faucet USDC, sends a 1 USDC payout with the memo, optionally runs the CCTP V2 burn (`SPLASH_E2E_CCTP=1`), and writes every signature to `docs/solana-build/devnet-run.json`. Usage is in the script header.

## Tests

```bash
npm test                   # every tests/*.test.mjs: 1,145 tests (2 skipped loudly: the LiteSVM binding)
npm run test:solana        # the Solana suite: 233 tests (keys, Squads, payout, CCTP, Kora, engine, partner, evidence, Zeke, app, treasury, transfer funding and details, admin)
npm run test:claims        # banned words, no Sui on any screen, integer money, the @mysten boundary
npm run lint               # copy, numbers, migrations, store access, env contract, ESLint
```

The browser walkthrough (`tests/solana-ui.e2e.mjs`) drives an installed Chrome or Edge through setup, treasury, an invoice, a transfer, a batch, a payment on a phone, the fund-first path and the staff console, at 1440 and 390 px. Its header says how to give it its own dev server and database, so it never touches one a person is using. Screenshots of every step are in `docs/solana-build/screenshots/`.

## Not verified yet (said plainly)
- **Devnet proof.** Nothing in this repo has run on devnet from the build machine (it had no Solana RPC access). `scripts/solana-devnet-e2e.ts` is how to prove it; the dashboard, batches, treasury moves and the fee payer's real balance have only run in the simulator.
- **Seal live.** Evidence encrypts through the Seal adapter, but the allowlist package is not published (gate G1). Offline, a stand-in key seals each record, and the receipt says so.
- **Walrus live.** The Walrus adapter has not stored a record on a live publisher from this build; offline, records are in a stand-in store.
- **Kora on devnet.** Kora's RPC method names and config keys come from its source code; they haven't been called against a running Kora.
- **SAS schema creation.** SAS instructions decode with sas-lib's own parsers; the schema has not been created on the deployed program, so anchors are SPL Memos today.
- **CCTP V2 from a vault.** A burn executed by Squads with an ephemeral event account is untested on-chain. The vault needs about 0.01 SOL for the event account's rent on that route, so "you don't need SOL" holds only for the direct route today.
- **Inbound CCTP.** Money arriving from another chain into a company's account through CCTP is not built or tested; only money in from a Solana wallet or another Splash business is.
- **Swap provider.** Paying in USDT or PYUSD swaps through a sandbox stand-in; no swap provider is integrated.
- **On-ramp.** Bank or card top-ups are sandbox stand-ins; no on-ramp partner is integrated.
- **Collection partner.** A payment request's "Pay by bank transfer" is hidden: there is no collection partner. Requests are paid from a crypto wallet or by another Splash business.
- **Matching money in on devnet.** A transfer into a requester's account is matched to its request in the simulator; on devnet nothing watches the account yet.
- **The Philippine bank list.** Recipient forms use a static list of banks and codes, not one from a real payout partner.
- **AWS KMS switched on.** Full bank numbers are sealed with a local key in development; switching on AWS KMS before the first real customer is described in `docs/security/PII-STORAGE.md`.
- **Sui's CCTP V2 status.** Not checked for this build.
- **Ondo adapters.** The T-bills and stocks adapters (`usdy-sim`, `ondo-stocks-sim`) are mocks; no live adapter builds a transaction for the Investments account.
- **Live USDY rate.** The T-bills rate is a dated reference (3.75% a year, as of 13 Oct 2026, from ondo.finance/usdy), not a live feed; past 35 days it shows "Rate out of date".
- **Ondo onboarding for direct subscriptions.** Subscribing straight from Ondo (and Ondo's own mint and redeem for stocks) needs the company onboarded with Ondo; in test mode it is simulated.
- **The USDY mint on Solana.** Taken from Ondo's own address list (`A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6`) and shown in Treasury's Technical details; nothing reads or moves it on-chain yet. The stock tokens' addresses are not checked and not used.
- **The 40-day hold.** Ondo's USDY page doesn't state a holding period after a subscription; 40 days (Business Module v15.1) is kept as the cautious assumption.
- **Ondo's wire-out redemption.** Redeeming with Ondo sends US dollars by bank wire to the company's bank, outside Splash (Ondo's documentation says so); in test mode it is simulated and never credits the Payments account.
- **A returned bank payout keeps Splash's fee.** The partner returns what it received; Splash's fee isn't part of that. Whether to refund the fee on a return is not decided.

## Prior work
This repo starts from the Splash Sui build (`sky9484/phase1` @ `3f78f5a`, 26 Sep 2026), imported unchanged in the first commit so the Solana build could reuse the UI system, copy guards, money helpers and policy code. That commit is prior work. Everything after it is the Solana build, made for this hackathon. See `docs/prior-work/PRIOR_WORK.md`.

## Team
- **Sky (Mohd Firdaus Hamid)**, founder and CEO, SPLASH MY SDN BHD. Years in banking and trade, watching finance teams chase proof of payment. Community lead, Sui Community Malaysia.
- **Sebastian**, CTO.

Splash is software and is not yet a licensed money-services business. Bank payouts are made by payout partners under their own terms; none is signed yet. Splash never holds the money.
