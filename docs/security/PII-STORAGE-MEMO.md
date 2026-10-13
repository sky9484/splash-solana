# Memo for Sebastian: storing full bank account numbers

**Written:** 13 Oct 2026. **Status:** decided by Sky on 13 Oct (gate G2 is closed). Built in prompt 10, Phase S (branch `sol/b0-p8-s-pii`).
**What Sebastian does:** review the build after it's done, using `docs/security/PII-STORAGE.md` (written in Phase S) and this memo. Nothing to decide before the build.
**Why:** customers now type the full bank account number, not only the last 4. A payout needs the full number, so we have to keep it. Once we keep it, a leak is our problem, not the partner's.

## Why this matters
- Malaysia PDPA (amended 2024, in force 1 June 2025): tell the Personal Data Protection Commissioner within 72 hours of finding a breach, and tell the affected people within 7 days if harm is likely.
- The Philippines Data Privacy Act 2012 covers our suppliers' data too.
- Counsel to confirm both.

## What gets built (in order)
0. **Every saved recipient gets a stable id.** Today `SupplierRecord` (`lib/solana-app/store.ts`) has no id. The id becomes the `beneficiary_id` below.
1. **One locked table**, `bank_account_secrets`: id, company id, beneficiary id, ciphertext, nonce, wrapped data key, key id, last 4, fingerprint, created at, replaced at, shred after, shredded at. Every other table keeps only the id and the last 4.
   - It sits behind a `SecretStore` interface: Postgres in real use, an in-memory store for the offline demo and tests.
2. **Envelope encryption:** AES-256-GCM, a new 12-byte nonce every time, a random data key per record, and that data key wrapped by a master key.
3. **Bound to its owner:** company id + beneficiary id are the AAD, so a ciphertext copied to another company won't decrypt.
4. **Master key never in code.** One `Kms` interface, two adapters:
   - `local`: keys from server environment variables. Used now. Refuses to run in production unless an override is set, and logs a warning if it is.
   - `aws`: AWS KMS in Singapore (`ap-southeast-1`). Built and tested with a mocked client, not switched on yet.
5. **Duplicate check:** HMAC-SHA256 of (bank code + account number) with a key held by the `Kms`. Not a plain or salted hash: 10–16 digit numbers can be brute-forced.
6. **Who can see the full number:**
   - the payout code, only while it builds the payout for the partner;
   - a person, only the owner or a finance admin (the existing `admin` role), after a fresh approval on their device, for 30 seconds, every view logged (allowed or refused);
   - Zeke never: it sees `•••• 4471` only.
7. **No sideways leaks:** never in logs, error messages, analytics, URLs, receipts, emails, Zeke's prompts, evidence bundles, Walrus or on-chain. A log scrubber, plus a test that fails the build if a full number shows up.
8. **Safe entry:** type the number twice, paste blocked on the second box, masked with "Show number"; format check from the partner's bank list. The Philippines partner doesn't check account names, so the phone call-back check stays.
9. **Changed bank details = a new record.** The old one is marked replaced, and the new details can't be paid until the call-back passes again.
10. **Safe deletion (crypto-shredding):** when a supplier is removed, its number is destroyed 30 days after its last payment settles, by deleting the data key and ciphertext. The last 4, the fingerprint and payment records stay for 7 years (Companies Act 2016).
11. **A one-page breach plan:** who decides, how to rotate keys, who notifies whom within 72 hours.

## Decisions (Sky, 13 Oct)
| Decision | Options we had | Sky decided |
|---|---|---|
| Key and region | AWS KMS or Google Cloud KMS, Singapore | A local key now (server environment only, never in git). **AWS KMS in `ap-southeast-1` is the target**, switched on before any real customer's bank number is stored. |
| Who can reveal | Owner only, or owner + finance admin | Owner + finance admin (`admin` role), each with a fresh device approval |
| How long | 30 or 60 seconds | 30 seconds |
| When a removed supplier's number is destroyed | Right away, or 30 or 90 days after its last payment settles | 30 days after its last payment settles |

## Tests
The full list is prompt 10, Phase S, section S.2 (the build's acceptance boxes). In short: round trip; wrong-company AAD fails; a changed byte fails; the fingerprint matches duplicates only; reveal without a fresh device approval, or by anyone other than the owner or an admin, is refused and logged; no full number in logs, analytics, receipts, evidence or Zeke's context; changed details block payment until the call-back; a shredded record can't be read while history still shows the last 4.

## Before the first real customer
1. Create the two AWS KMS keys in `ap-southeast-1` (an encryption key and an HMAC key).
2. Set `PII_KMS=aws`, `PII_AWS_KMS_KEY_ARN` and `PII_AWS_HMAC_KEY_ARN` on the server.
3. Re-wrap any data keys made with the local key (the steps are in `PII-STORAGE.md`).
4. Remove the local keys from the server.

Sources: [Malaysia tightens data protection from June 2025](https://www.china-briefing.com/china-outbound-news/malaysia-tightens-data-protection-from-june-2025); [Tranglo: Philippines payout specification](https://www.tranglo.com/docs/tranglo-connect/service-specification/philippines/).
