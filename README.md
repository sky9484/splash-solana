# Splash on Solana

**Pay suppliers. Prove everything.**

Every month, finance teams across Southeast Asia pay suppliers abroad, then spend days proving it: the invoice in email, the approval in WhatsApp, the rate in a screenshot. Splash pays the supplier in USDC on Solana and keeps one record of the whole payment: invoice, approval, transfer and rate.

- **Your vault, your keys.** Every business gets its own Squads V4 vault with no config authority. Splash holds no key that can move the money.
- **AI that works, never spends.** Zeke reads the invoice and compares routes. A person signs every payment.
- **One record per payment.** The evidence record is hashed into a Merkle root and anchored on Solana, and anyone holding the receipt can verify it.

Built for Colosseum (submission 12 Oct 2026). First corridor: Malaysia to the Philippines.

> **What is real and what is mock.** The vault, keys, transactions, policy checks, route ranking and evidence are real code with tests. The **payout partner is a labelled mock** ("Mock partner · devnet": its peso rate is a fixed reference, not a live rate). Wallet screening (KYT) is a stub. The demo runs **offline by default** with a chain simulator that checks every signature and Squads threshold; every screen and receipt then says "Simulated · devnet-ready". The same code path runs on devnet with `SPLASH_SOLANA_MODE=devnet`.

## The problem
- The World Bank's Remittance Prices Worldwide puts the average cost of sending money from Malaysia to the Philippines at **3.92%**, with banks charging **up to 9.56%** and **1.49%** hidden in the exchange rate (Q3 2025, US$200 and US$500 sends; retail prices, so a floor for business payments).
- The Philippines makes compliant e-invoices mandatory on or before 31 Dec 2026 (BIR RMC 098-2026). Every supplier payment will need to match an invoice.

## The flow (one payment, end to end)
1. **Onboard.** Company name → a recovery kit of 24 words made in the browser (BIP39, SLIP-0010 `m/44'/501'/0'/0'`) → a non-extractable WebCrypto Ed25519 device key → a **Squads V4 vault with no config authority** (members: device key + kit, threshold 1, `configAuthority` null). The server only ever sees public keys and proof-of-possession signatures.
2. **Fund.** USDC to the payments vault: moved in from the company's **treasury** (vault #1 of the same multisig, one device approval, memo `splash:move:v1:<id>`, no Splash fee), or sent from any Solana wallet (devnet: Circle's faucet).
3. **Invoice.** Zeke's Reader extracts the fields in quarantine (no tools; document text is data, injected instructions are flagged). A person confirms every field. A new bank detail can't be paid until it is verified out of band.
4. **Quote.** The engine compares **Solana direct** to the partner's one-payment deposit address with a **CCTP V2 burn on Solana minting at the partner's Polygon address**, and ranks them by **pesos the supplier receives**: Cheapest, Fastest, Safest. Zeke explains; it can't change a route.
5. **Policy.** Deterministic checks: tier limits, per-payment cap, screening (stub), duplicate invoice, quote expiry, bank details verified.
6. **Approve.** The approval card is built only from confirmed fields and the quote, never from model text. The device key signs the Squads proposal and approval; the vault executes. **Kora** pays the network fee, so the business doesn't need SOL on the direct route.
7. **Deliver.** The mock partner sends HMAC-signed webhooks: received, then paid with a bank reference.
8. **Prove.** A kind-3 evidence bundle (invoice commitment, approval chain, quoted vs executed route, signatures, FX rate, bank reference) is hashed into a Merkle root and anchored with an SPL Memo, or a Solana Attestation Service attestation. The receipt page re-verifies it, and fails when any field is tampered with.

The same path pays a **transfer** with no invoice (Dashboard → Transfer): a person types the recipient, the amount and a reference, and from the quote on it is steps 4 to 8 unchanged. A new recipient still needs a call-back. Invoices show where each one is on the loop (read by Zeke, checked by a person, approved on a device, paid to the bank, proof anchored).

## Architecture

| Layer | Choice | Where |
|---|---|---|
| Identity | App sign-in only; it never holds a key | — |
| Daily signer | WebCrypto Ed25519, non-extractable, in IndexedDB | `lib/solana/device-key.ts` |
| Recovery | 24-word kit made on the device; walk-away with the Squads app | `lib/solana/recovery-kit.ts` |
| Wallet | Squads V4 multisig per business, no config authority | `lib/solana/squads.ts` |
| Asset | Native USDC (classic SPL, not Token-2022) | `lib/solana/config.ts` |
| Invoice reference | SPL Memo with a salted commitment only, never a name or invoice number | `lib/solana/payout.ts` |
| Fees | Kora fee payer; allowlisted programs; it never sends SOL or tokens | `lib/solana/kora.ts`, `kora.toml` |
| Cross-chain | CCTP V2 burn from the vault (event account = Squads ephemeral signer) | `lib/solana/cctp-v2-solana.ts` |
| Engine | Ranked by local currency received; home-lane rule; 0.33% all-in target | `lib/route-engine/` |
| Evidence | Canonical JSON, domain-separated Merkle tree, Memo or SAS anchor | `lib/solana-evidence/` |
| Agent | Zeke: quarantined Reader, explaining Router, no signing functions | `lib/solana-zeke/` |
| App | Next.js routes under `/solana`, API under `/api/solana` | `app/solana/`, `lib/solana-app/` |

**Invariants (each has a test):** Splash holds no key on any vault and `configAuthority` is null · a payout goes only to the partner's deposit address · the fee payer never moves SOL or tokens · every supplier payment needs a person's signature (execute without it returns 403) · memos carry only the salted commitment · the approval card renders only deterministic fields · simulated receipts are always labelled.

## Run it

```bash
npm ci --engine-strict=false   # the repo pins Node 24; Node 22 works for this demo
npx next dev -p 3100
# open http://localhost:3100/solana → "Start the demo"
```

No env is needed offline. For devnet:

```bash
SPLASH_SOLANA_MODE=devnet SOLANA_RPC_URL=https://api.devnet.solana.com \
KORA_RPC_URL=<your Kora> KORA_API_KEY=<key> npx next dev -p 3100
```

**Real devnet signatures:** `scripts/solana-devnet-e2e.ts` creates a vault, waits for faucet USDC, sends a 1 USDC payout with the memo, optionally runs the CCTP V2 burn (`SPLASH_E2E_CCTP=1`), and writes every signature to `docs/solana-build/devnet-run.json`. Usage is in the script header.

## Tests

```bash
npm run test:solana        # 106 tests: keys, Squads, payout, CCTP, Kora, engine, partner, evidence, Zeke, app flow
node --test tests/solana-ui.e2e.mjs   # browser walkthrough at 1440 and 390 px (needs the dev server)
```

Screenshots of every step are in `docs/solana-build/screenshots/`.

## Not verified yet (said plainly)
- Nothing in this repo has run on devnet from the build machine (it had no Solana RPC access). The e2e script is how to prove it.
- A CCTP V2 burn executed by Squads with an ephemeral event account is untested on-chain. The vault needs about 0.01 SOL for the event account's rent on that route, so "you don't need SOL" holds only for the direct route today.
- Kora's RPC method names and config keys come from its source code; they haven't been called against a running Kora.
- SAS instructions decode with sas-lib's own parsers; the deployed program hasn't accepted them yet.

## Prior work
This repo starts from the Splash Sui build (`sky9484/phase1` @ `3f78f5a`, 26 Sep 2026), imported unchanged in the first commit so the Solana build could reuse the UI system, copy guards, money helpers and policy code. That commit is prior work. Everything after it is the Solana build, made for this hackathon. See `docs/prior-work/PRIOR_WORK.md`.

## Team
- **Sky (Mohd Firdaus Hamid)**, founder and CEO, SPLASH MY SDN BHD. Years in banking and trade, watching finance teams chase proof of payment. Community lead, Sui Community Malaysia.
- **Sebastian**, CTO.

Splash is software and is not yet a licensed money-services business. Bank payouts are made by payout partners under their own terms; none is signed yet. Splash never holds the money.
