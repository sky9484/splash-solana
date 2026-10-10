/// PayoutDelegation — how a batch becomes executable by one signer.
///
/// ─── The problem this solves ────────────────────────────────────────────────
///
/// `settle_batch` takes BOTH `&AdminCap` and `&BusinessAccount`. `AdminCap` is
/// `key, store` and goes to the cold 2-of-3 multisig; `BusinessAccount` is
/// address-owned by the tenant (`business_account.move` ends
/// `submit_application` with `transfer::transfer(account, owner)`).
///
/// A Sui transaction may only name owned objects belonging to its SENDER. Two
/// owned objects, two different owners, one transaction — impossible. Adding
/// the `owner == tx_context::sender` assert (closing S-07's operator-trusted
/// attribution) made it worse still: it pins the sender to the tenant, which
/// excludes the `AdminCap` input outright.
///
/// So `settle_batch` is not "inconvenient after the key ceremony". It is
/// UNCALLABLE. The runbook's option A — "accept it, batch becomes a
/// multisig-signed operation" — cannot be performed at all.
///
/// ─── The fix ────────────────────────────────────────────────────────────────
///
/// The delegation REPLACES `&BusinessAccount` in the batch signature rather than
/// sitting alongside it. The tenant mints one from their own wallet — the only
/// transaction that can name their `BusinessAccount` — and it is transferred to
/// the operator, who then owns it and can name it. One signer, one transaction,
/// and the attribution is still chain-enforced because the delegation carries
/// the owner it was minted from.
///
/// What the operator gains is narrow by construction: they may pay only from
/// this tenant's credit, only up to a rate the tenant set, only until the
/// delegation expires, and only while it has not been revoked.
module splash_custody::delegation;

use splash_core::business_account::{Self, BusinessAccount};
use splash_meter::spend_meter::{Self, SpendMeter};
use sui::clock::{Self, Clock};
use sui::event;

// ─── Abort codes (110-block, continuing settlement's 100-range) ─────────────
const E_NOT_ACCOUNT_OWNER:   u64 = 110;
const E_NOT_VERIFIED:        u64 = 111;
const E_DELEGATION_EXPIRED:  u64 = 112;
const E_DELEGATION_REVOKED:  u64 = 113;
const E_TTL_TOO_LONG:        u64 = 114;
const E_INVALID_OPERATOR:    u64 = 115;
const E_WRONG_DELEGATION:    u64 = 116;
const E_EPOCH_INVALIDATED:   u64 = 117;

/// A delegation may never outlive 30 days. This is the dead-man switch: a
/// tenant who stops re-granting stops being payable, so an abandoned
/// integration decays closed rather than staying open indefinitely. It is also
/// the containment bound if a tenant's own key is lost.
const MAX_TTL_MS: u64 = 2_592_000_000;

/// Owned by the OPERATOR after `grant`. `key` only — no `store` — so it cannot
/// be `public_transfer`red onward, wrapped, or sold. The operator cannot pass it
/// to anyone; if they are compromised, revocation is the remedy, not
/// re-custody.
public struct PayoutDelegation has key {
    id: UID,
    /// The tenant that granted it. This is what makes `PaymentExecuted`
    /// attribution chain-enforced without needing the `BusinessAccount` object
    /// in the settling transaction.
    business_owner: address,
    /// The pool this delegation may draw from. A delegation for the SUI pool
    /// cannot touch the USDC pool.
    pool: ID,
    /// Address permitted to use it. Checked against `tx_context::sender` on
    /// every settle, so a stolen delegation object is useless from another
    /// address — possession alone is not authority.
    operator: address,
    expires_at_ms: u64,
    revoked: bool,
    /// Pool-wide invalidation counter, copied at mint. `revoke_all` on the pool
    /// increments its own counter, which instantly invalidates every delegation
    /// in flight — INCLUDING ones sitting in a compromised operator's address,
    /// which the multisig cannot reach directly because they are owned objects.
    epoch: u64,
    /// The tenant's OWN rate limit, independent of the pool-wide meter. A
    /// tenant can bound their exposure below whatever the protocol allows.
    meter: SpendMeter,
}

public struct DelegationGranted has copy, drop {
    delegation_id: address,
    business_owner: address,
    pool: ID,
    operator: address,
    expires_at_ms: u64,
    per_tx_cap: u64,
    window_cap: u64,
}

public struct DelegationRevoked has copy, drop {
    delegation_id: address,
    business_owner: address,
    by_owner: bool,
}

// ─── Grant ──────────────────────────────────────────────────────────────────

/// Called by the TENANT, from their own wallet, naming their own
/// `BusinessAccount` — the one transaction that can.
///
/// `epoch` comes from the pool and is supplied by the caller of the wrapper in
/// `settlement`, which reads it off the shared pool object.
public(package) fun grant(
    account: &BusinessAccount,
    pool: ID,
    epoch: u64,
    operator: address,
    ttl_ms: u64,
    per_tx_cap: u64,
    window_cap: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(business_account::owner(account) == tx_context::sender(ctx), E_NOT_ACCOUNT_OWNER);
    // Delegating from an unverified account would let KYB be bypassed by
    // granting first and never completing verification.
    assert!(business_account::is_verified(account), E_NOT_VERIFIED);
    assert!(operator != @0x0, E_INVALID_OPERATOR);
    assert!(ttl_ms > 0 && ttl_ms <= MAX_TTL_MS, E_TTL_TOO_LONG);

    let now = clock::timestamp_ms(clock);
    let delegation = PayoutDelegation {
        id: object::new(ctx),
        business_owner: business_account::owner(account),
        pool,
        operator,
        expires_at_ms: now + ttl_ms,
        revoked: false,
        epoch,
        meter: spend_meter::new(per_tx_cap, window_cap, clock),
    };

    event::emit(DelegationGranted {
        delegation_id: object::uid_to_address(&delegation.id),
        business_owner: delegation.business_owner,
        pool,
        operator,
        expires_at_ms: delegation.expires_at_ms,
        per_tx_cap,
        window_cap,
    });

    // Transferred to the operator so THEY can name it as an input. The tenant
    // never types an operator address by hand — the dashboard supplies it and
    // the event records where it went.
    transfer::transfer(delegation, operator);
}

// ─── Use ────────────────────────────────────────────────────────────────────

/// Validate and charge. Every condition is checked at EXECUTION time, not at
/// grant time — a delegation that was valid when minted must not stay valid
/// after expiry, revocation, or a pool-wide epoch bump.
public(package) fun authorize(
    delegation: &mut PayoutDelegation,
    pool: ID,
    pool_epoch: u64,
    amount: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(delegation.pool == pool, E_WRONG_DELEGATION);
    assert!(!delegation.revoked, E_DELEGATION_REVOKED);
    // One increment on the shared pool kills every delegation at once, without
    // needing to touch objects the multisig cannot reach.
    assert!(delegation.epoch == pool_epoch, E_EPOCH_INVALIDATED);
    assert!(delegation.operator == tx_context::sender(ctx), E_INVALID_OPERATOR);
    assert!(clock::timestamp_ms(clock) < delegation.expires_at_ms, E_DELEGATION_EXPIRED);

    let id = object::id(delegation);
    spend_meter::charge(&mut delegation.meter, id, amount, clock);
}

// ─── Revoke ─────────────────────────────────────────────────────────────────

/// The tenant pulls their own authority. Takes effect immediately.
public fun revoke_by_owner(delegation: &mut PayoutDelegation, account: &BusinessAccount, ctx: &TxContext) {
    assert!(business_account::owner(account) == tx_context::sender(ctx), E_NOT_ACCOUNT_OWNER);
    assert!(delegation.business_owner == business_account::owner(account), E_NOT_ACCOUNT_OWNER);
    delegation.revoked = true;
    event::emit(DelegationRevoked {
        delegation_id: object::id_address(delegation),
        business_owner: delegation.business_owner,
        by_owner: true,
    });
}

/// Admin revocation of a single delegation, for the case where the tenant is
/// unreachable. Pool-wide revocation lives on the pool itself, because the
/// multisig cannot name owned delegation objects it does not hold.
public(package) fun revoke_by_admin(delegation: &mut PayoutDelegation) {
    delegation.revoked = true;
    event::emit(DelegationRevoked {
        delegation_id: object::id_address(delegation),
        business_owner: delegation.business_owner,
        by_owner: false,
    });
}

/// Burn a spent or unwanted delegation. Callable by whoever holds it.
public fun destroy(delegation: PayoutDelegation) {
    let PayoutDelegation {
        id,
        business_owner: _,
        pool: _,
        operator: _,
        expires_at_ms: _,
        revoked: _,
        epoch: _,
        meter,
    } = delegation;
    spend_meter::destroy(meter);
    id.delete();
}

// ─── Views ──────────────────────────────────────────────────────────────────

public fun business_owner(d: &PayoutDelegation): address { d.business_owner }
public fun pool(d: &PayoutDelegation): ID { d.pool }
public fun operator(d: &PayoutDelegation): address { d.operator }
public fun expires_at_ms(d: &PayoutDelegation): u64 { d.expires_at_ms }
public fun is_revoked(d: &PayoutDelegation): bool { d.revoked }
public fun epoch(d: &PayoutDelegation): u64 { d.epoch }
public fun remaining_at(d: &PayoutDelegation, now_ms: u64): u64 {
    spend_meter::remaining_at(&d.meter, now_ms)
}
public fun max_ttl_ms(): u64 { MAX_TTL_MS }
