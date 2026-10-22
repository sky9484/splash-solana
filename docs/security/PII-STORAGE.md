# Storing full bank account numbers: what was built

For Sebastian's review (prompt 10, Phase S). The design is the memo, `docs/security/PII-STORAGE-MEMO.md`; this page says what the code does, where, and what is still open.

## Sky's three decisions (13 Oct, decision 15)
1. **The key:**
   - a local key now, in the server environment only and never in git;
   - **AWS KMS in Singapore (`ap-southeast-1`) is the target.** It must be switched on before any real customer's bank number is stored.
   - Both sit behind one `Kms` interface.
2. **Who can see a full number:**
   - the owner and the finance admin (the existing `admin` membership role; no new role);
   - each needs a fresh device approval, and the number shows **for 30 seconds**;
   - every view is logged.
3. **When a removed supplier's number is destroyed:**
   - 30 days after its last payment settles (crypto-shredding);
   - the last 4 digits, the fingerprint and the payment records stay for 7 years.

## What was built
| Piece | Where | What it does |
|---|---|---|
| Stable recipient ids | `lib/solana-app/store.ts` `ensureSupplierIds`, called from `lib/solana-app/company.ts` `loadCompany` | Every saved recipient gets `sup_<uuid>` the first time its company is read. The id is assigned *after* the load snapshot, so the next save writes it back. Running it again changes nothing. Removal goes by id. |
| The locked table | `bank_account_secrets` (`drizzle/0034_bank_account_secrets.sql`, `lib/db/schema.ts`) | Columns: id, org_id, beneficiary_id, ciphertext, nonce, wrapped_data_key, key_id, last4, fingerprint, created_at, replaced_at, shred_after, shredded_at. Database rules: a row is either sealed (all three blobs present) or shredded (none); `last4` is four digits; one current record per recipient. |
| The reveal log | `bank_account_reveals` (same migration) | Who asked (user), when, which recipient and record, and the result (`challenged`, `revealed`, `refused`) with a reason. It never holds the number. |
| `SecretStore` | `lib/solana-app/bank-secret-store.ts` | Two adapters with the same behaviour: Postgres (used when `DATABASE_URL` is set) and memory (the offline demo and tests; nothing on disk). Every read names the company; the one cross-company read is the shred job's, named `dueForShredAcrossCompanies`. `scripts/check-store-access.mjs` fails the lint if any other file touches the two tables. |
| Envelope encryption | `lib/server/pii-vault.ts` | AES-256-GCM, a new 12-byte nonce and a random 32-byte data key per record. The data key is wrapped by the `Kms`, then wiped. **Associated data = company id + recipient id**, on both the number and the wrapped key. |
| Key service | `lib/server/kms/` (`types.ts`, `local.ts`, `aws.ts`, `index.ts`) | `wrap`, `unwrap`, `hmac`, `keyId`, chosen by `PII_KMS=local\|aws`. Details are under "The key service" below. |
| Fingerprint | `pii-vault.ts` `fingerprintOf` | HMAC-SHA256 of (bank code + account number) under the key service's HMAC key. Not a plain or salted hash. |
| Who can open a number | `lib/server/bank-details.ts` | Details are under "Who can open a number" below. |
| Changed bank details | `bank-details.ts` `saveBankNumber`, `lib/solana-app/service.ts` `bankStatusFor` | A different number is a new record, and the old one gets `replaced_at`. A first full number whose last 4 aren't the verified account's counts as a change too. The recipient is held (`pendingCallBack`) until a call-back passes. Until then it reads as "changed", so the existing rule refuses the quote ("New bank details. Verify by phone before paying."), and the payout read is refused. |
| Crypto-shredding | `bank-details.ts` `scheduleShredForRemoved`, `shredDue`; `app/api/cron/pii-shred/route.ts` | Removing a recipient sets `shred_after` to 30 days after its last settled payment, or 30 days from removal if it was never paid. The daily job deletes the ciphertext, nonce and wrapped key of due records and stamps `shredded_at`. It is idempotent and protected by `CRON_SECRET` (`lib/server/cron-auth.ts`). |
| No sideways leaks | `lib/server/log-scrub.ts`, installed first in `instrumentation.ts`; `lib/solana-app/http.ts` | Details are under "No sideways leaks" below. |
| Breach plan | `docs/security/BREACH-PLAN.md` | One page: who decides, key rotation (re-wrap every data key), and notification windows. |

### The key service
- **`local`:** keys from `PII_LOCAL_WRAP_KEY` and `PII_LOCAL_HMAC_KEY` (base64, 32 bytes each, and they must differ).
  - **Production:** refused unless `PII_ALLOW_LOCAL_IN_PROD=1`, and then a warning is logged. The same refusal is in `lib/env.ts`, so production does not start.
  - **Offline simulator with no keys set:** throwaway keys made at start-up, logged once.
- **`aws`:** built and tested with a mocked client, not switched on. Details are under "Switching from the local key to AWS KMS" below.

### Who can open a number
- **The payout path:** `bankNumberForPayout`, just in time and never stored with the payment. It is refused while changed details wait for a call-back.
- **A person**, through `POST /api/solana/recipients/[id]/reveal`. It takes two steps:
  1. `{step:'challenge'}` returns a server challenge bound to the company, recipient, member and device key. It is single use and lasts 60 seconds.
  2. `{step:'reveal', nonce, signature}` checks the role (owner or `admin`), the challenge and the ed25519 signature by this member's device key. It returns the number with `expires_at` 30 seconds ahead.
  - Every call, allowed or refused, writes a reveal-log row. That includes a malformed request and one naming a recipient that isn't there.
  - The signed text starts `splash:challenge:v1:reveal`, so it can never be a valid transaction.
- **Zeke:** never.

### No sideways leaks
- **Logs:** every `console` argument is scrubbed. Account-shaped digit runs (8 to 20 digits, plain or grouped 4-4-4) keep their last 4, and so do fields named like an account number or IBAN.
- **Errors:** an unexpected error's message is scrubbed before it is sent to the browser.
- **Elsewhere:** the evidence bundle, receipts, analytics events and Zeke's context carry the last 4 only.

## Switching from the local key to AWS KMS
Do this before any real customer's bank number is stored.
1. **Create two keys in `ap-southeast-1`:**
   - a **symmetric encryption** key (`SYMMETRIC_DEFAULT`), for wrapping;
   - an **HMAC** key (`HMAC_256`), for fingerprints.

   Give the app's role only `kms:Encrypt` and `kms:Decrypt` on the first and `kms:GenerateMac` on the second. Turn on CloudTrail data events for both.
2. **Install the SDK:** `npm install @aws-sdk/client-kms`. Use a release at least two weeks old, and run `npm audit`. It is not a dependency until now: `lib/server/kms/aws.ts` loads it at runtime only when `PII_KMS=aws`.
3. **Set the environment:**
   - `PII_KMS=aws`;
   - `PII_AWS_KMS_KEY_ARN=arn:aws:kms:ap-southeast-1:<account>:key/<id>`;
   - `PII_AWS_HMAC_KEY_ARN=…`;
   - credentials from the host's role (or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`), never in a file.

   An ARN in another region is refused.
4. **Re-wrap the existing records:** with both key services configured, run `rewrapDataKey(local, aws, row, ctx)` over every unshredded row and save it with `SecretStore.rewrap`. The fingerprints change with the HMAC key, so recompute them in the same job (it is the one place a number is opened in bulk).
5. **Check:** no row has a `key_id` starting with `local:`; one reveal and one payout work.
6. **Remove the local keys:** delete `PII_LOCAL_WRAP_KEY`, `PII_LOCAL_HMAC_KEY` and `PII_ALLOW_LOCAL_IN_PROD` from every host.

## Environment variables (declared in `lib/env.ts`, listed in `.env.example` with no values)
`PII_KMS`, `PII_LOCAL_WRAP_KEY`, `PII_LOCAL_HMAC_KEY`, `PII_ALLOW_LOCAL_IN_PROD`, `PII_AWS_KMS_KEY_ARN`, `PII_AWS_HMAC_KEY_ARN`. The shred job also uses the existing `CRON_SECRET`.

## What is tested (the memo's list, S.2)
| Check | Test |
|---|---|
| Every saved recipient has a stable id after the first read; running it twice changes nothing | `tests/supplier-ids.test.mjs` (including a company document written before ids, through Postgres) |
| Both `SecretStore` adapters pass the same tests; the offline demo needs no database | `tests/pii-secret-store.test.mjs` (memory and PGlite with the real migrations) |
| Encrypt then decrypt gives back the same number | `tests/pii-vault.test.mjs` |
| Another company's id fails (associated data); so does another recipient's | `tests/pii-vault.test.mjs` |
| One changed byte (ciphertext, nonce or wrapped key) fails | `tests/pii-vault.test.mjs` |
| Same bank and number give the same fingerprint; a different one, a different fingerprint; another key, another fingerprint | `tests/pii-vault.test.mjs` |
| Reveal without a fresh step-up is refused (none, expired, reused, someone else's, wrong device); `maker`, `checker` and `viewer` are each refused; all audited | `tests/pii-reveal.test.mjs` |
| A revealed number comes back with `expires_at` 30 seconds ahead | `tests/pii-reveal.test.mjs` |
| No full number in captured logs, error responses, company documents, payments, the reader's record, the reveal log, Zeke's context, evidence bundles or analytics | `tests/pii-no-leaks.test.mjs` |
| Changed bank details block payment until the call-back passes | `tests/pii-reveal.test.mjs` (payout read), `tests/pii-payment-gate.test.mjs` (the quote is refused) |
| The shred job deletes due records only, is idempotent, and history keeps `last4` | `tests/pii-secret-store.test.mjs`, `tests/pii-reveal.test.mjs` |
| The local adapter refuses production without the override; the AWS adapter passes with a mocked client | `tests/pii-vault.test.mjs` |
| `check:env`, `check:migrations` and `check:stores` pass | `npm run lint` |

## Still open
- **Legacy plaintext numbers.** The legacy fiat recipients table, `suppliers` (`bank_account_number`, `account_ref`), holds full numbers in plaintext. It is written by the legacy Recipients page (`/dashboard/recipients` → `/api/recipients`) and by Zeke's `proposeRecipientFromInvoice` (`lib/agent/oxwal.ts`), and read by the travel-rule payload. It predates this phase and is not on the Solana payment path. It needs a decision before any real customer: move those numbers into `bank_account_secrets` or drop the columns. `tests/pii-no-leaks.test.mjs` pins it as the one known exception, so a new plaintext column fails the build.
- **The reader sends invoice text to the model.** The invoice reader sends the whole invoice text, account number included, to the model on devnet (not offline) to read it. Only last 4 is kept; the full number is not written to the vault by the reader yet. Phase 3's entry flow (§5.3) is where a full number enters, typed twice.
- **The invoice text goes back to the browser.** `POST /api/solana/invoices` returns the invoice text it read. That is the person's own document, but for an uploaded PDF it is text the browser did not have before.
- **Single-process state.** Device-approval challenges are kept in process memory (60 seconds). With more than one server instance, a challenge and its answer must reach the same one, or the reveal is refused (it fails safe). A durable challenge store is a follow-up, together with the existing in-memory nonce store.
- **No scheduler in the repo.** The repo has no `vercel.json` or other scheduler config. The host must call `GET /api/cron/pii-shred` daily with `Authorization: Bearer $CRON_SECRET`. On Vercel, that is `{"crons":[{"path":"/api/cron/pii-shred","schedule":"0 18 * * *"}]}` (02:00 in Kuala Lumpur).
- **Who signs off notifications.** Counsel, for the notification windows in `BREACH-PLAN.md`.
