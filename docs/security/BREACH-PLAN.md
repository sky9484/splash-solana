# Breach plan: bank account numbers

One page. It covers the full bank account numbers stored under prompt 10 Phase S (`docs/security/PII-STORAGE.md`). It is a working plan, not legal advice: **counsel confirms the notification duties and wording before the first real customer's number is stored.**

## What could be exposed
- **`bank_account_secrets`:** sealed numbers. Each row holds the AES-256-GCM ciphertext, its nonce, the data key *wrapped by the key service*, the last 4 digits, and a keyed fingerprint.
- **On their own, the rows show nothing:** opening one needs the key service (the local wrap key now, AWS KMS later).
- **`bank_account_reveals`:** who asked to see which recipient's number, and when.
- **Everything else stores only the last 4 digits.** That covers company documents, payments, receipts, evidence, Walrus, the chain and logs.

## Who decides
| Role | Person | Decides |
|---|---|---|
| Incident lead | Sky (founder) | declares an incident, owns this plan, signs off notifications |
| Security reviewer | Sebastian | confirms scope from the logs, runs the key rotation |
| Counsel | (to appoint before go-live) | confirms what must be notified, to whom, and the wording |

If the incident lead can't be reached within 2 hours, the security reviewer acts as lead.

## The first hour
1. **Stop the leak.**
   - Revoke the suspected credential (database user, host secret, AWS access key).
   - If the key service itself may be exposed, set `PII_KMS` to a new key (step 2) before anything else reads a number.
2. **Freeze reveals.** Remove the `admin` role from everyone but the owner, and let reveals be refused (each refusal is still logged).
3. **Keep evidence:** take a database snapshot, the host's logs and, on AWS, the KMS CloudTrail events (every Decrypt names the company and recipient in its encryption context).
4. **Start the clock.** Write down the time the breach was *found*: the 72 hours run from then.

## Rotate the keys (re-wrap every data key)
The numbers themselves are never decrypted for a rotation; only their data keys are re-wrapped.
1. **Create the new key(s):**
   - **AWS:** a new symmetric key and a new HMAC key in `ap-southeast-1`.
   - **Local:** two new 32-byte values (`openssl rand -base64 32`).
2. **Re-wrap.** For each row of `bank_account_secrets` that is not shredded:
   - call `rewrapDataKey(oldKms, newKms, row, { orgId, beneficiaryId })` (`lib/server/pii-vault.ts`);
   - store the result with `SecretStore.rewrap` (`lib/solana-app/bank-secret-store.ts`), which records the new `key_id`;
   - check that no row still carries the old `key_id`.
3. **Fingerprints:** if the HMAC key may be exposed, recompute each fingerprint. This means opening each number once with the new key service, inside the rotation job only.
4. **Switch over:** point the environment at the new keys, restart, and confirm that one reveal and one payout work.
5. **Retire the old key:**
   - **AWS:** disable it, then schedule deletion.
   - **Local:** remove it from every host and secret store.

## Notify
- **Malaysia** (Personal Data Protection Act 2010, as amended 2024): the Personal Data Protection Commissioner within **72 hours** of finding the breach, and affected people within **7 days** if it is likely to cause them significant harm. Counsel to confirm.
- **Philippines** (Data Privacy Act 2012): the recipients are in the Philippines. The National Privacy Commission and the affected people within 72 hours, where the law requires it. Counsel to confirm.
- **Customers:** each affected company is told which of its recipients were involved (named by last 4 digits), what happened, and what we did.
- **Partners:** the payout partner, if payout instructions could be affected.

## Afterwards
- Within 14 days, write a short report: timeline, cause, what was exposed (from the reveal log and the key service's logs), and what changed.
- Run the S.2 test list again, and add a test for the cause.
