# Decisions: Solana build (prompt 07)

Each entry says what was decided, why, and what would make us revisit it.

---

## D-P1-1 · No Privy. Sign-in is email/password or Google; approvals are a device key (prompt 07 §3.3)

**Decision.** The account is email + password (scrypt, rate-limited) or "Continue with Google" (plain OIDC, code + PKCE). Approvals are Ed25519 signatures from a non-extractable WebCrypto key on the member's device (`lib/solana/device-key.ts`). Recovery is a 24-word kit made in the browser. Privy is not adopted.

**Why not Privy.**
- **Policy duplication.** Squads already enforces who approves and how many approvals are needed, on-chain. Privy's wallet policies would duplicate that off-chain, in a second place that can disagree with the first. This is the same reason Privy was rejected on the Sui build.
- **Custody story.** Privy holds key shares (TEE or sharding). "Splash holds no key" would then depend on a third party, and every custody question in diligence would need a third-party answer.
- **Cost and coupling.** Per-user pricing, and vendor lock-in on the most sensitive path in the product.
- **We already have it.** The device key and recovery kit are built and tested (keys, recovery kit and Squads tests in `npm run test:solana`).

**Revisit if** multi-device use or browser Ed25519 support becomes the top onboarding complaint.

**Multi-device today.** A second device is added to the vault as a new member by a config transaction that existing members approve. Splash cannot add it: the vault's config authority is none. The registry records one active device per member per organisation (`member_devices`), and a device on record but not in the vault can sign nothing (`device_not_in_vault`).

---

## D-P1-2 · Google proves identity only, and its proof of the mailbox kills an unproven password

**Decision.** A Google sign-in links to an account by **verified** email only (`email_verified: true`, strictly the boolean). If an account with that email exists but was never verified, Google's proof is treated like opening a delivered verification link: the account is marked verified, the credential version moves (every earlier session dies), and the existing password is **discarded**.

**Why.** Otherwise there is a pre-account hijack:
1. An attacker signs up first with the victim's email and a password of their choosing.
2. The victim later proves the mailbox through Google.
3. The attacker's password would then open a verified account.

`tests/google-account-link.test.mjs` pins this.

**Also.**
- The nonce is required on every Google sign-in. The earlier build's verifier skipped the nonce check when the client left the parameters out.
- No key material is derived from the Google identity (`tests/device-key-authority.test.mjs`).

---

## D-P1-3 · The device check runs in two places: proxy (optimistic) and layout (authoritative)

**Decision.** `/dashboard/*` money pages require `ready`: a member, with a registered device, whose device is a member of the organisation's vault.
- **Authoritative check:** the dashboard layout reads the database on full page loads and fails closed.
- **Optimistic check:** `proxy.ts` checks every request, using only a signed cookie (`splash_setup`) bound to the session's email, credential version and device key. It never reads the database.

**Why both.**
- **Layouts don't re-run on client-side navigation.** So the layout alone would let a sidebar click from setup to transfer through.
- **A database read in the proxy on every request is the wrong cost.** The local PGlite server also serves one connection, and the proxy's separate pool broke it.
- **This is the Next.js auth guide's split.** It prescribes exactly this: an optimistic check in the proxy, a secure check next to the data.
- **Signatures are the real control.** The routes that move money still require a fresh device signature on the vault proposal; the gate is the screen-level half.

**Revisit if** device revocation must take effect between full page loads. Then clear the cookie on revocation (it is bound to the device key, so a revoked key's cookie can be refused once revocation writes are added).

---

## D-P1-4 · Proving the keys and creating the vault happen in one request

**Decision.** The owner's setup sends the device-key proof and the recovery-kit proof together. The server verifies both, creates the vault, and records the device and the vault in **one database transaction**.

**Why.** If the device were recorded first and the vault created in a later request, a restart in between would lose the kit's public key, which only ever lived in the browser tab's memory. The member would then hold a registered device with no way to create the vault, and the one-active-device rule would stop them from starting again.

If the database write fails after the chain call, the vault exists without a record. Setup can be run again (a new vault is made), and the orphan holds no money.

---

## D-P1-5 · The passkey stays, as a sign-in check only

**Decision.** The passkey screen (`/settings/security`) now presents the passkey as a second check at sign-in. It no longer appears as "your approval signer", and no copy says it approves payments.

**Not done in Phase 1.** Its WebAuthn plumbing still comes from the earlier build (`@mysten/sui/keypairs/passkey` in `components/auth/PasskeyEnrolment.tsx`, `lib/auth/passkey.ts`, `lib/server/step-up.ts`). Replacing it with plain WebAuthn verification belongs to Phase 2, which confines `@mysten/*` to `lib/evidence-sui/`. The earlier build's approval flows that sign with the passkey (`components/approvals/*`) are replaced by device-key approvals in Phase 3.

---

## D-P2-1 · One device key for Solana and Seal, pending G2 (prompt 07 §4.3)

The member's non-extractable Ed25519 device key is their Squads member (base58) and their Seal identity (blake2b256(0x00 ‖ pubkey)). `lib/evidence-sui/device-sui-signer.ts` lets the Sui SDK use it without exporting it.

Why reuse is safe: the key signs three disjoint kinds of bytes.
- **Sui:** only 32-byte intent digests. The signer refuses any other length.
- **Solana:** transaction messages, which are always longer than 32 bytes.
- **Splash:** the `splash:challenge:v1:` text, which parses as neither a Solana message nor an intent.

An Ed25519 signature is valid for exactly one message, so a signature made for one kind can't be replayed as another. The vectors in `tests/device-sui-signer.test.mjs` match both SDKs byte for byte.

**If Sebastian says no** at G2: generate a second non-extractable key for evidence only, and have the recovery kit hold both.

## D-P2-2 · The Seal allowlist is member-governed, not capability-governed (§4.4, gate G1)

The phase1 policy gave the issuer a transferable `Cap`, and whoever held it could change the list. §4.4 says only an existing member may, and that the sponsor has no cap. So `move/splash_evidence` has no Cap at all: authority is `ctx.sender()` being a member.

Adding or removing a member revokes every auditor grant. The last member can't be removed. Grants are capped at 90 days.

Not published. The README carries the security review and two decisions for Sebastian:
- make the UpgradeCap immutable (recommended)
- require the Squads threshold for membership changes, or keep it a single member

## D-P2-3 · SAS schema v2 binds an anchor to its Walrus blobs (§4.5)

`splash.evidence.root.v2` replaces `sui_digest` with `walrus_blob_ids_root`: sha256 over the batch's blob ids, sorted and joined with newlines, as lowercase hex. A verifier holding the batch's blob ids can then check that none was swapped.

v1 was never created on devnet, and SAS schemas are immutable, so this is a new schema name rather than a migration.

## D-P2-4 · Wallet recipients are Solana addresses; old rows are kept but cannot be paid

- Migration 0029 replaces the wallet-shape CHECK with a base58 one and Solana wallet providers. It is `NOT VALID`, so earlier-build rows stay as history.
- `normaliseSolanaAddress` refuses them before any send.
- Addresses are trimmed and **never re-cased**, because base58 is case-sensitive.

## D-P2-5 · Native USDC deposits go to the org's own vault

- The earlier build derived a per-business deposit key from a server secret. On Solana that would be a Splash-held key, so it is gone.
- A deposit is a Solana Pay request to the org's Squads vault.
- CCTP deposits still start at the configured source-chain address.
- Funding is USDC only (D-7).

## D-P2-6 · Zeke states no fee percentage until Phase 3

The canon plan fee (0.10%, minimum US$2) lives in `lib/route-engine/fees.ts`. The dashboard quote still uses `lib/fx/corridors.ts`, which charges 70 bps.

So that Zeke never contradicts the quote a person sees, its replies point at the fee line in the quote instead of a number. Phase 3 moves the dashboard quote onto the route engine, and the number can return then.

## D-P2-7 · The §4.2 grep allows the evidence layer, and nothing else

`tests/solana-boundary.test.mjs` runs the §4.2 grep over app, components and lib. It allows only these:
- `lib/evidence-sui/**`
- import paths into it (the directory name contains "sui")
- its env keys
- the /trust evidence sentence
- the admin "Sui sponsor (evidence only)" label

Note: the pattern's case-insensitive `PTB` also matches inside words such as `ReceiptByHash`. Such lines were reworded rather than allow-listed.

## D-P3-1 · Compute budget and ATA creation sit at the top level, not inside the vault transaction (§5.3)

§5.3 lists, inside the vault transaction:
- ComputeBudget
- an ATA create
- the payout transferChecked
- the fee transferChecked
- the memo

Two of these cannot work there:
- **ComputeBudget** instructions only take effect at the top level of a transaction. Inside a Squads vault transaction they run as a CPI and do nothing.
- **An ATA create** needs a rent payer. The vault holds only USDC, never SOL.

So each outer transaction (proposal and execute) starts with limit, then price, and the ATA creates sit before the execute with Kora as rent payer. The vault transaction holds exactly the payout leg, the fee leg and the memo, so the fee and the payment still succeed or fail together.

- The priority fee is the 75th percentile of `getRecentPrioritizationFees`, capped with the sponsor check's own formula at 100,000 lamports.
- The unit limit comes from a simulation plus 15% where one is possible. The execute cannot be simulated before its proposal exists, so it uses a default.

## D-P3-2 · 0.10% per payout on every route (D17)

`lib/route-engine/fees.ts` charged 0.15% on Fastest and Safest under an earlier canon. Prompt 07 §5.2 (D17) says 0.10% per payout, so every policy is now 10 bps.

Unchanged:
- the US$2 minimum
- the 0.33% all-in target from US$2,000
- the 0.05% floor

The table is still per-policy, so reverting is one line. The dashboard's older quote (`lib/fx/corridors.ts`, 70 bps) is replaced in Phase 4, when /dashboard/transfer moves onto this engine.

## D-P3-3 · No address lookup table in batch chunks (§5.5 vs §5.6)

§5.5 asks for one ALT per batch. §5.6 allowlists exactly nine programs for sponsored transactions, and the lookup-table program is not one of them. `validateSponsoredTransaction` also refuses lookups.

The batch is chunked by measured size without an ALT: five payees per chunk today, with the execute the binding constraint at 1,203 of 1,232 bytes. Adding an ALT needs two changes Sebastian should approve:
- add `AddressLookupTab1e1111111111111111111111111` to `kora.toml` and `SPONSOR_ALLOWED_PROGRAMS`
- let the sponsor check accept lookups whose tables the app created

## D-P3-4 · The money-path memo is `splash:pay:v1:<paymentId>` (§5.3)

The earlier memo carried the salted invoice commitment. §5.3 asks for the payment id only. That is an opaque random `pay_` + 16 hex, so there is still no invoice data on chain (I-5). The commitment stays in the evidence bundle.

The simulator and sponsor check accept both formats, so the runs recorded before this change still verify.

## D-P3-5 · Kora signs, Splash broadcasts (§5.1)

`DevnetChain` used Kora's `signAndSendTransaction`, so the signature was unknown until after broadcast, and a crash mid-send could not be resumed by signature. It now works in this order:
1. Call `signTransaction`.
2. Check that Kora returned the exact message the approver signed.
3. Record the signature under `paymentId:step`.
4. Broadcast it.

A resumed worker polls that signature. It never sends again.

## D-P3-6 · Where the state lives, and what is still in memory

**Durable:**
- Payments: `solana_payments`, with transitions and chain calls, whenever `DATABASE_URL` is set (`SOLANA_PAYMENT_STORE=memory` overrides).
- The per-org sponsorship counter.

**Still in process memory** until Phase 4 moves the flow onto signed-in organizations:
- the offline demo's companies and invoices
- the invoice reservation and the daily-limit reservation

Within one process those reservations are atomic: the check and the reservation happen with no await between them. Across instances, the payment's own compare-and-set still prevents a double send of one payment. Two payments for one invoice on two instances is the gap Phase 4 closes.
