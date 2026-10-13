# splash_evidence

The Seal access policy for Splash evidence, and the **only** Move package in the
Solana build (prompt 07 §4.4). Settlement is on Solana; this package decides one
thing: who may decrypt an organisation's evidence bundles, which are encrypted
with Seal and stored on Walrus. It holds no value and has no power over any
account.

## Status: gate G1, needs Sebastian

- **Not published.** No publish, upgrade or address change without Sebastian's
  written confirmation in the PR. Nothing in the app depends on it yet:
  `scripts/evidence-live-check.ts` skips its Seal step until
  `EVIDENCE_ALLOWLIST_OBJECT_ID` exists.
- `sui move build` is clean and `sui move test` passes 26/26 on Sui CLI 1.77.2.
- There are no third-party dependencies, no `Coin` and no `Balance`.

## The rules, and where each one lives

| §4.4 rule | Enforced by |
|---|---|
| 1. `seal_approve` passes only for a current member, or an auditor whose grant hasn't expired, and only for an identity under this list's namespace | `approve_internal` |
| 2. Only an existing member can add or remove members, or grant an auditor. The sponsor pays gas, is never a member, and has no cap it could use to add itself | `assert_member`: authority is `ctx.sender()` being a member. There is **no capability object** at all |
| 3. Creating an org's list needs the first approver's signature | `create`: the sender becomes the first member |
| 4. Any authority change revokes outstanding auditor grants | `add` and `remove` both clear every grant |

Additions over the phase1 version (`sky9484/phase1@feat/v15-splash-evidence`):

- **No `Cap`.** Phase1 gave the issuer a transferable `Cap` with `store`, and
  whoever held it could change the list, Splash included. Membership can't be
  handed over.
- **Adding a member revokes grants too.** Phase1 revoked only on removal.
- **The last member can't be removed.** Otherwise the org's evidence would
  become unreadable to everyone.
- **Grants are capped at 90 days** (`MAX_GRANT_MS`), and members can't hold a
  grant.
- **No label field and no `anchor` module.** Nothing about a payment or a person
  is on Sui. Anchoring is a SAS attestation on Solana
  (`lib/solana-evidence/anchor.ts`).

## How it is used

- One `Allowlist` per org. It is shared, so a member's transaction and Seal's
  dry run can both reach it.
- A member's Sui address is their device key's Sui address
  (`lib/evidence-sui/device-sui-signer.ts`): the same Ed25519 key as their
  Solana address. Gate G2 covers that reuse.
- Every change is a **sponsored** transaction. The sender is the member, signing
  with their device key, and the gas owner is `EVIDENCE_SPONSOR`. The server
  signs as sponsor only for an authenticated member session, and only for a
  `<pkg>::allowlist` call (`lib/evidence-sui/sponsor.ts`, `assertSponsorable`).
- Ciphertexts are encrypted to `[allowlist id][nonce]`
  (`lib/evidence-sui/seal.ts`, `sealIdentity`).

## Security review (sui-security-auditor), for Sebastian

**Confirmed safe, each covered by a test:**

- **Object substitution.** A member of their own list presenting another org's
  identity is refused, because the namespace prefix is checked first.
- **Sponsor.** As a sender, the sponsor can't add itself, grant itself access,
  or pass `seal_approve`.
- **Auditor.** An auditor can't grant access to anyone else.
- **Bounds.** Lists hold at most 16 members and 16 grants, so `seal_approve`
  stays cheap and a list can't grow without limit.
- **Time.** Expiry is strict (`now < expires_ms`), and the `expires_ms - now`
  subtraction is guarded.

**Decisions this needs (not bugs in the code):**

1. **Upgrade authority — High, design.** Whoever holds the package's
   `UpgradeCap` can publish a new `seal_approve` that admits anyone, Splash
   included. Recommendation: publish, then call `0x2::package::make_immutable`
   on the `UpgradeCap`. The policy is small and fully tested, and immutability is
   what makes "Splash keeps no readable copy" true against Splash itself. If
   upgrades must stay possible, hold the cap in a cold multisig with a
   published time-lock, and say so on /trust.
2. **One member is enough to change the list — Medium, design.** Any member can
   add or remove another, so one compromised device can add an attacker. Two
   ways to tighten it:
   - Mirror the Squads threshold: changes need N of the members, using a
     proposal object.
   - Keep single-member changes, but have the app show every `MemberAdded` and
     `MemberRemoved` event to the whole org.

   The prompt's rule 2 says "an existing member", so it's implemented that way;
   the threshold is Sebastian's call.
3. **The sponsor address isn't blocked on chain — Low.** A member could
   deliberately add Splash's sponsor address. The server never builds that
   transaction, and adding it would be the member's own act. A hard block would
   need the sponsor address fixed at create time.
