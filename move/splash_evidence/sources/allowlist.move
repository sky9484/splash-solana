/// Allowlist — the Seal access policy for one organisation's evidence.
///
/// Splash keeps, for every payment, an evidence bundle (invoice hash, the
/// approvals, the route quoted and executed, the partner's confirmation). It is
/// encrypted with Seal under an identity that starts with this object's id and
/// stored on Walrus; Splash keeps no readable copy. This object decides who
/// may decrypt it.
///
/// Seal's contract with a policy module is one function, `seal_approve`. A key
/// server dry-runs it with the requester as the transaction sender and the
/// identity bytes the ciphertext was encrypted to; if it does not abort, the
/// server releases its key share.
///
/// The rules (prompt 07 §4.4), and where each is enforced:
///
///   1. `seal_approve` passes only for a current member, or for an auditor
///      whose grant has not expired, and only for an identity under this
///      list's namespace.                               → approve_internal
///   2. Only an existing member can add or remove members or grant an
///      auditor. Authority is membership, checked against `ctx.sender()`;
///      there is no capability object that could be handed to anyone. Splash's
///      evidence sponsor pays the gas of a member's transaction but is not its
///      sender, is never added as a member by Splash, and so can change
///      nothing.                                         → assert_member
///   3. Creating an org's list requires the first approver's own signature:
///      the creator (the transaction sender, their device key's Sui address)
///      is the first member.                             → create
///   4. Any authority change — adding or removing a member — revokes every
///      outstanding auditor grant at once. A change in who is trusted with the
///      evidence invalidates the trust each grant was issued under. (phase1
///      revoked on removal only; adding a member is an authority change too.)
///                                                       → add, remove
///
/// Also: a list can never lose its last member (the evidence would become
/// unreadable to anyone), grants are time-boxed to at most MAX_GRANT_MS, and
/// nothing about a payment or a person is stored here — addresses and expiries
/// only. This module cannot move, freeze or approve money.
module splash_evidence::allowlist;

use sui::clock::Clock;
use sui::event;

// ─── Abort codes ───────────────────────────────────────────────────────────
const ENoAccess: u64 = 700;
const ENotAMember: u64 = 701;
const EDuplicate: u64 = 702;
const EInvalidAddress: u64 = 703;
const EExpiryInThePast: u64 = 704;
const ETooMany: u64 = 705;
const ELastMember: u64 = 706;
const EGrantTooLong: u64 = 707;
const ENoSuchGrant: u64 = 708;
const EMemberCannotBeGranted: u64 = 709;

/// A list is small by design: an org's approvers, not a directory. The bound
/// also keeps `seal_approve` cheap to dry-run.
const MAX_MEMBERS: u64 = 16;
const MAX_GRANTS: u64 = 16;
/// The longest an auditor may hold access in one grant: 90 days. A longer
/// engagement is a fresh grant, made by a member, on the record.
const MAX_GRANT_MS: u64 = 90 * 24 * 60 * 60 * 1000;

// ─── Objects ───────────────────────────────────────────────────────────────

/// Shared, so a member's sponsored transaction and Seal's dry run can both
/// reach it. No `store`: it cannot be wrapped or moved, only shared.
public struct Allowlist has key {
    id: UID,
    /// The org's approvers (their device keys' Sui addresses).
    members: vector<address>,
    /// Time-boxed outsiders. Cleared by every authority change.
    grants: vector<Grant>,
    /// Bumped by every change, so an indexer can tell two states apart.
    generation: u64,
}

public struct Grant has copy, drop, store {
    who: address,
    expires_ms: u64,
}

// ─── Events ────────────────────────────────────────────────────────────────
// Object ids, addresses and numbers only. No names, no amounts.

public struct AllowlistCreated has copy, drop {
    allowlist: ID,
    creator: address,
}

public struct MemberAdded has copy, drop {
    allowlist: ID,
    by: address,
    member: address,
    grants_revoked: u64,
    generation: u64,
}

public struct MemberRemoved has copy, drop {
    allowlist: ID,
    by: address,
    member: address,
    grants_revoked: u64,
    generation: u64,
}

public struct GrantIssued has copy, drop {
    allowlist: ID,
    by: address,
    who: address,
    expires_ms: u64,
    generation: u64,
}

public struct GrantRevoked has copy, drop {
    allowlist: ID,
    by: address,
    who: address,
    generation: u64,
}

// ─── Create ────────────────────────────────────────────────────────────────

/// Create an org's list. The sender — the first approver, signing with their
/// device key — is its first member. Splash may sponsor the gas; it cannot be
/// the sender, because the sender is the one who becomes a member.
entry fun create(ctx: &mut TxContext) {
    let creator = ctx.sender();
    let allowlist = Allowlist {
        id: object::new(ctx),
        members: vector[creator],
        grants: vector[],
        generation: 0,
    };
    event::emit(AllowlistCreated { allowlist: object::id(&allowlist), creator });
    transfer::share_object(allowlist);
}

// ─── Membership (members only) ─────────────────────────────────────────────

/// A member adds an approver. Revokes every auditor grant (rule 4).
entry fun add(allowlist: &mut Allowlist, member: address, ctx: &TxContext) {
    let by = assert_member(allowlist, ctx);
    assert!(member != @0x0, EInvalidAddress);
    assert!(!allowlist.members.contains(&member), EDuplicate);
    assert!(allowlist.members.length() < MAX_MEMBERS, ETooMany);
    allowlist.members.push_back(member);
    // An auditor who becomes a member no longer needs a grant either way.
    let grants_revoked = revoke_all_grants(allowlist);
    allowlist.generation = allowlist.generation + 1;
    event::emit(MemberAdded {
        allowlist: object::id(allowlist),
        by,
        member,
        grants_revoked,
        generation: allowlist.generation,
    });
}

/// A member removes an approver (themselves included, unless they are the
/// last). Revokes every auditor grant (rule 4).
entry fun remove(allowlist: &mut Allowlist, member: address, ctx: &TxContext) {
    let by = assert_member(allowlist, ctx);
    let (found, index) = allowlist.members.index_of(&member);
    assert!(found, ENotAMember);
    assert!(allowlist.members.length() > 1, ELastMember);
    allowlist.members.remove(index);
    let grants_revoked = revoke_all_grants(allowlist);
    allowlist.generation = allowlist.generation + 1;
    event::emit(MemberRemoved {
        allowlist: object::id(allowlist),
        by,
        member,
        grants_revoked,
        generation: allowlist.generation,
    });
}

// ─── Auditor grants (members only) ─────────────────────────────────────────

/// A member gives an outsider read access until `expires_ms`, at most
/// MAX_GRANT_MS from now. Re-granting the same address replaces its expiry.
entry fun grant(allowlist: &mut Allowlist, who: address, expires_ms: u64, clock: &Clock, ctx: &TxContext) {
    let by = assert_member(allowlist, ctx);
    assert!(who != @0x0, EInvalidAddress);
    assert!(!allowlist.members.contains(&who), EMemberCannotBeGranted);
    let now = clock.timestamp_ms();
    assert!(expires_ms > now, EExpiryInThePast);
    assert!(expires_ms - now <= MAX_GRANT_MS, EGrantTooLong);
    let existing = find_grant(allowlist, who);
    if (existing.is_some()) {
        allowlist.grants.remove(existing.destroy_some());
    } else {
        assert!(allowlist.grants.length() < MAX_GRANTS, ETooMany);
    };
    allowlist.grants.push_back(Grant { who, expires_ms });
    allowlist.generation = allowlist.generation + 1;
    event::emit(GrantIssued {
        allowlist: object::id(allowlist),
        by,
        who,
        expires_ms,
        generation: allowlist.generation,
    });
}

/// A member ends one grant early.
entry fun revoke(allowlist: &mut Allowlist, who: address, ctx: &TxContext) {
    let by = assert_member(allowlist, ctx);
    let existing = find_grant(allowlist, who);
    assert!(existing.is_some(), ENoSuchGrant);
    allowlist.grants.remove(existing.destroy_some());
    allowlist.generation = allowlist.generation + 1;
    event::emit(GrantRevoked {
        allowlist: object::id(allowlist),
        by,
        who,
        generation: allowlist.generation,
    });
}

// ─── The Seal policy ───────────────────────────────────────────────────────

/// The identity prefix every ciphertext under this list is encrypted to.
/// Callers append their own nonce: `[namespace][nonce]`
/// (lib/evidence-sui/seal.ts sealIdentity).
public fun namespace(allowlist: &Allowlist): vector<u8> {
    allowlist.id.to_bytes()
}

/// Seal calls this. It aborts unless `ctx.sender()` may read `id` (rule 1).
entry fun seal_approve(id: vector<u8>, allowlist: &Allowlist, clock: &Clock, ctx: &TxContext) {
    assert!(approve_internal(ctx.sender(), id, allowlist, clock.timestamp_ms()), ENoAccess);
}

/// The same decision, as a value, for tests and off-chain previews.
public fun can_read(allowlist: &Allowlist, who: address, id: vector<u8>, now_ms: u64): bool {
    approve_internal(who, id, allowlist, now_ms)
}

fun approve_internal(caller: address, id: vector<u8>, allowlist: &Allowlist, now_ms: u64): bool {
    if (!is_prefix(namespace(allowlist), id)) return false;
    if (allowlist.members.contains(&caller)) return true;
    let existing = find_grant(allowlist, caller);
    if (existing.is_none()) return false;
    let grant = &allowlist.grants[existing.destroy_some()];
    now_ms < grant.expires_ms
}

// ─── Views ─────────────────────────────────────────────────────────────────

public fun members(allowlist: &Allowlist): &vector<address> { &allowlist.members }
public fun is_member(allowlist: &Allowlist, who: address): bool { allowlist.members.contains(&who) }
public fun generation(allowlist: &Allowlist): u64 { allowlist.generation }
public fun grant_count(allowlist: &Allowlist): u64 { allowlist.grants.length() }
public fun max_grant_ms(): u64 { MAX_GRANT_MS }

// ─── Internals ─────────────────────────────────────────────────────────────

/// Rule 2: the sender must be a member. Returns the sender for the event.
fun assert_member(allowlist: &Allowlist, ctx: &TxContext): address {
    let sender = ctx.sender();
    assert!(allowlist.members.contains(&sender), ENotAMember);
    sender
}

fun revoke_all_grants(allowlist: &mut Allowlist): u64 {
    let n = allowlist.grants.length();
    allowlist.grants = vector[];
    n
}

fun find_grant(allowlist: &Allowlist, who: address): Option<u64> {
    let mut i = 0;
    let n = allowlist.grants.length();
    while (i < n) {
        if (allowlist.grants[i].who == who) return option::some(i);
        i = i + 1;
    };
    option::none()
}

fun is_prefix(prefix: vector<u8>, word: vector<u8>): bool {
    if (prefix.length() > word.length()) return false;
    let mut i = 0;
    while (i < prefix.length()) {
        if (prefix[i] != word[i]) return false;
        i = i + 1;
    };
    true
}

// ─── Test-only entry points ────────────────────────────────────────────────
// `entry` functions are not callable from another module, so tests reach them
// through these wrappers. They add no capability: each calls the real rule.

#[test_only]
public fun create_for_testing(ctx: &mut TxContext) { create(ctx) }

#[test_only]
public fun add_for_testing(allowlist: &mut Allowlist, member: address, ctx: &TxContext) { add(allowlist, member, ctx) }

#[test_only]
public fun remove_for_testing(allowlist: &mut Allowlist, member: address, ctx: &TxContext) { remove(allowlist, member, ctx) }

#[test_only]
public fun grant_for_testing(allowlist: &mut Allowlist, who: address, expires_ms: u64, clock: &Clock, ctx: &TxContext) {
    grant(allowlist, who, expires_ms, clock, ctx)
}

#[test_only]
public fun revoke_for_testing(allowlist: &mut Allowlist, who: address, ctx: &TxContext) { revoke(allowlist, who, ctx) }

#[test_only]
public fun seal_approve_for_testing(id: vector<u8>, allowlist: &Allowlist, clock: &Clock, ctx: &TxContext) {
    seal_approve(id, allowlist, clock, ctx)
}
