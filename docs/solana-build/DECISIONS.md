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

## D-P2-x · Key reuse across Solana and Seal (prompt 07 §4.3, gate G2)

*To be written in Phase 2, after Sebastian answers G2.*
