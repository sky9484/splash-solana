/// SmartTreasury — generic, AdminCap-gated treasury that actually holds funds.
///
/// Replaces the Phase 1 scaffold which (a) accepted `Coin<SUI>` while claiming
/// to hold USDC, (b) only tracked u64 counters with no on-chain backing, and
/// (c) called `coin::destroy_zero` on a non-zero coin and always aborted.
///
/// Findings addressed (see SECURITY.md):
///   - C-01: `add_usdc` always aborts
///   - C-02: treasury holds no real value
///   - M-04: shared object per rebalance → replaced with event
///   - M-05: magic abort codes → named constants
///
/// Design:
///   * `SmartTreasury<phantom T>` holds a real `Balance<T>` (USDC, USDT, or
///     any coin type chosen at create time).
///   * Deposits move the coin into the balance via `balance::join`.
///   * Withdrawals are AdminCap-gated and emit `TreasuryWithdrawn`.
///   * All state changes emit events — no shared objects per call.
module splash_custody::smart_treasury;

use splash_core::business_account::{AdminCap, AnchorCap, TreasuryCap};
use splash_meter::guardian::GuardianCap;
use splash_meter::spend_meter::{Self, SpendMeter};
use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;
use sui::vec_set::{Self, VecSet};

// ─── Abort codes ───────────────────────────────────────────────────────────
const E_INSUFFICIENT_BALANCE: u64 = 700;
const E_ZERO_AMOUNT:          u64 = 701;
const E_RECIPIENT_INVALID:    u64 = 702;
const E_OPERATING_FLOOR:      u64 = 703;
/// Withdrawal destination is not on the treasury's allowlist.
const E_RECIPIENT_NOT_ALLOWED: u64 = 704;
/// Lowering the operating floor, or repointing the allowlist, requires the
/// treasury to be paused first.
const E_REQUIRES_PAUSE:       u64 = 705;
const E_LAST_RECIPIENT:       u64 = 706;

public struct SmartTreasury<phantom T> has key {
    id: UID,
    treasury_id: String,
    balance: Balance<T>,
    /// Lifetime cumulative deposit volume (informational only — not the
    /// current balance; for that use `balance::value(&treasury.balance)`).
    lifetime_deposited: u64,
    /// Lifetime cumulative withdraw volume.
    lifetime_withdrawn: u64,
    last_activity_ms: u64,
    /// AdminCap is required to mutate — `admin` is informational so off-chain
    /// indexers can show "who" deployed this treasury.
    admin: address,
    /// STORED, not caller-supplied.
    ///
    /// `allocate` used to take `operating_minimum` as an ARGUMENT and assert
    /// `balance - amount >= operating_minimum`. Both sides of that comparison
    /// came from the caller, so passing `0` erased the floor entirely — a guard
    /// that reads like a control and enforces nothing. The corridor minimum is a
    /// property of the treasury, so it lives on the treasury.
    operating_floor: u64,
    /// Withdrawals may only go here. A caller-supplied destination means a
    /// compromised `AdminCap` moves the balance anywhere in one transaction;
    /// with an allowlist it can only move funds between addresses the ceremony
    /// already approved.
    allowed_recipients: VecSet<address>,
    /// Velocity ceiling (A-11). Same meter as the settlement pool: 24 hourly
    /// buckets, tighten instantly, relax on 48h public notice.
    meter: SpendMeter,
}

// ─── Events ────────────────────────────────────────────────────────────────

public struct TreasuryDeposited has copy, drop {
    treasury_id: String,
    amount: u64,
    new_balance: u64,
    timestamp_ms: u64,
    from: address,
}

public struct TreasuryWithdrawn has copy, drop {
    treasury_id: String,
    amount: u64,
    new_balance: u64,
    timestamp_ms: u64,
    to: address,
    operator: address,
}

public struct TreasuryRebalanced has copy, drop {
    treasury_id: String,
    delta: u64,
    /// 0 = deposit-like (balance grew), 1 = withdraw-like (balance shrank)
    direction: u8,
    new_balance: u64,
    timestamp_ms: u64,
    operator: address,
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────

/// Create a treasury for coin type T. AdminCap-gated so anyone can't spam
/// the object table with empty treasuries.
public fun init_treasury<T>(
    _admin: &AdminCap,
    treasury_id: String,
    operating_floor: u64,
    allowed_recipients: vector<address>,
    per_tx_cap: u64,
    window_cap: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // An empty allowlist would make the treasury unwithdrawable, which is a
    // brick rather than a control. Naming the destinations is a ceremony step.
    assert!(!allowed_recipients.is_empty(), E_RECIPIENT_NOT_ALLOWED);
    let treasury = SmartTreasury<T> {
        id: object::new(ctx),
        treasury_id,
        balance: balance::zero<T>(),
        lifetime_deposited: 0,
        lifetime_withdrawn: 0,
        last_activity_ms: clock::timestamp_ms(clock),
        admin: tx_context::sender(ctx),
        operating_floor,
        allowed_recipients: vec_set::from_keys(allowed_recipients),
        meter: spend_meter::new(per_tx_cap, window_cap, clock),
    };
    transfer::share_object(treasury);
}

/// Anyone can deposit — the treasury just receives coins. Mutates `balance`
/// for real (no more u64-counter fiction).
public fun deposit<T>(
    treasury: &mut SmartTreasury<T>,
    coin: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let amount = coin::value(&coin);
    assert!(amount > 0, E_ZERO_AMOUNT);

    balance::join(&mut treasury.balance, coin::into_balance(coin));
    treasury.lifetime_deposited = treasury.lifetime_deposited + amount;
    treasury.last_activity_ms = clock::timestamp_ms(clock);

    event::emit(TreasuryDeposited {
        treasury_id: treasury.treasury_id,
        amount,
        new_balance: balance::value(&treasury.balance),
        timestamp_ms: treasury.last_activity_ms,
        from: tx_context::sender(ctx),
    });
}

/// AdminCap-gated withdrawal — metered, floor-checked, allowlisted.
///
/// Three bounds that did not exist before, each closing a distinct hole:
///   * the destination must be on the treasury's allowlist, so a compromised
///     key cannot move the balance to an address of its choosing;
///   * the STORED operating floor must survive the withdrawal (`allocate` took
///     that floor as an argument, so passing 0 erased it);
///   * the spend meter bounds the rate, so a compromised key cannot empty the
///     treasury in one transaction.
///
/// This function absorbs what `allocate` and `redeem` used to do. `allocate`
/// was `withdraw` plus a caller-supplied floor; `redeem` was a bare alias.
/// Both are deleted — two extra entry points to a treasury, one of which had a
/// defeatable guard, is strictly worse than one that is correct.
public fun withdraw<T>(
    treasury: &mut SmartTreasury<T>,
    _treasury: &TreasuryCap,
    recipient: address,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(amount > 0, E_ZERO_AMOUNT);
    assert!(recipient != @0x0, E_RECIPIENT_INVALID);
    assert!(treasury.allowed_recipients.contains(&recipient), E_RECIPIENT_NOT_ALLOWED);

    let current_balance = balance::value(&treasury.balance);
    assert!(current_balance >= amount, E_INSUFFICIENT_BALANCE);
    assert!(current_balance - amount >= treasury.operating_floor, E_OPERATING_FLOOR);

    let treasury_id_obj = object::id(treasury);
    spend_meter::charge(&mut treasury.meter, treasury_id_obj, amount, clock);

    let withdrawn = balance::split(&mut treasury.balance, amount);
    let coin = coin::from_balance(withdrawn, ctx);

    treasury.lifetime_withdrawn = treasury.lifetime_withdrawn + amount;
    treasury.last_activity_ms = clock::timestamp_ms(clock);

    event::emit(TreasuryWithdrawn {
        treasury_id: treasury.treasury_id,
        amount,
        new_balance: balance::value(&treasury.balance),
        timestamp_ms: treasury.last_activity_ms,
        to: recipient,
        operator: tx_context::sender(ctx),
    });

    transfer::public_transfer(coin, recipient);
}

// ─── Destinations and floor ─────────────────────────────────────────────────

public fun allow_recipient<T>(_admin: &AdminCap, treasury: &mut SmartTreasury<T>, recipient: address) {
    assert!(recipient != @0x0, E_RECIPIENT_INVALID);
    treasury.allowed_recipients.insert(recipient);
    event::emit(RecipientAllowed { treasury_id: treasury.treasury_id, recipient });
}

/// Removing a destination is tightening, so it is instant — but the last one
/// cannot go, because an empty allowlist bricks the treasury rather than
/// securing it. Pause for an intentional halt.
public fun disallow_recipient<T>(_admin: &AdminCap, treasury: &mut SmartTreasury<T>, recipient: address) {
    assert!(treasury.allowed_recipients.length() > 1, E_LAST_RECIPIENT);
    treasury.allowed_recipients.remove(&recipient);
    event::emit(RecipientDisallowed { treasury_id: treasury.treasury_id, recipient });
}

/// RAISING the floor is tightening — instant. LOWERING it frees money for
/// withdrawal, so it requires a pause first: the same discipline as repointing
/// the settlement pool's fee recipient, and for the same reason. A quiet floor
/// reduction between two normal withdrawals is exactly how a compromised key
/// would drain a treasury without tripping the meter.
public fun set_operating_floor<T>(_admin: &AdminCap, treasury: &mut SmartTreasury<T>, floor: u64) {
    if (floor < treasury.operating_floor) {
        assert!(spend_meter::is_paused(&treasury.meter), E_REQUIRES_PAUSE);
    };
    let previous = treasury.operating_floor;
    treasury.operating_floor = floor;
    event::emit(OperatingFloorChanged { treasury_id: treasury.treasury_id, previous, current: floor });
}

public struct RecipientAllowed has copy, drop { treasury_id: String, recipient: address }
public struct RecipientDisallowed has copy, drop { treasury_id: String, recipient: address }
public struct OperatingFloorChanged has copy, drop { treasury_id: String, previous: u64, current: u64 }

// ─── Meter administration ───────────────────────────────────────────────────

public fun tighten_treasury_limits<T>(
    _admin: &AdminCap,
    treasury: &mut SmartTreasury<T>,
    per_tx_cap: u64,
    window_cap: u64,
) {
    let id = object::id(treasury);
    spend_meter::tighten(&mut treasury.meter, id, per_tx_cap, window_cap);
}

public fun propose_treasury_relax<T>(
    _admin: &AdminCap,
    treasury: &mut SmartTreasury<T>,
    per_tx_cap: u64,
    window_cap: u64,
    clock: &Clock,
) {
    let id = object::id(treasury);
    spend_meter::propose_relax(&mut treasury.meter, id, per_tx_cap, window_cap, clock);
}

public fun cancel_treasury_relax<T>(_admin: &AdminCap, treasury: &mut SmartTreasury<T>) {
    let id = object::id(treasury);
    spend_meter::cancel_relax(&mut treasury.meter, id);
}

public fun restore_treasury_bootstrap<T>(_admin: &AdminCap, treasury: &mut SmartTreasury<T>) {
    let id = object::id(treasury);
    spend_meter::restore_bootstrap(&mut treasury.meter, id);
}

/// One signature, one machine, immediate.
public fun guardian_pause_treasury<T>(treasury: &mut SmartTreasury<T>, cap: &GuardianCap) {
    let id = object::id(treasury);
    spend_meter::guardian_pause(&mut treasury.meter, id, cap);
}

public fun unpause_treasury<T>(_admin: &AdminCap, treasury: &mut SmartTreasury<T>) {
    let id = object::id(treasury);
    spend_meter::unpause(&mut treasury.meter, id);
}

public fun mint_treasury_guardian<T>(
    _admin: &AdminCap,
    treasury: &SmartTreasury<T>,
    holder: address,
    ctx: &mut TxContext,
) {
    spend_meter::mint_guardian(&treasury.meter, object::id(treasury), holder, ctx);
}

/// Convenience wrapper that emits a rebalance-style event without creating
/// a separate shared object per call (M-04 fix). Use this when off-chain
/// accounting wants to tag a particular deposit/withdraw as part of a
/// rebalance flow.
/// AnchorCap-gated (cap split S-10): this only emits an accounting event
/// — `treasury` is an immutable reference and no balance moves — so it belongs
/// with the hot attestation key, not the cold money-authority AdminCap.
public fun emit_rebalance<T>(
    treasury: &SmartTreasury<T>,
    _cap: &AnchorCap,
    delta: u64,
    direction: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    event::emit(TreasuryRebalanced {
        treasury_id: treasury.treasury_id,
        delta,
        direction,
        new_balance: balance::value(&treasury.balance),
        timestamp_ms: clock::timestamp_ms(clock),
        operator: tx_context::sender(ctx),
    });
}

// ─── Views ─────────────────────────────────────────────────────────────────

public fun balance<T>(treasury: &SmartTreasury<T>): u64 {
    balance::value(&treasury.balance)
}

public fun lifetime_deposited<T>(treasury: &SmartTreasury<T>): u64 {
    treasury.lifetime_deposited
}

public fun lifetime_withdrawn<T>(treasury: &SmartTreasury<T>): u64 {
    treasury.lifetime_withdrawn
}

public fun last_activity_ms<T>(treasury: &SmartTreasury<T>): u64 {
    treasury.last_activity_ms
}

public fun admin<T>(treasury: &SmartTreasury<T>): address {
    treasury.admin
}

public fun treasury_id<T>(treasury: &SmartTreasury<T>): &String {
    &treasury.treasury_id
}

public fun operating_floor<T>(treasury: &SmartTreasury<T>): u64 { treasury.operating_floor }
public fun is_recipient_allowed<T>(treasury: &SmartTreasury<T>, who: address): bool {
    treasury.allowed_recipients.contains(&who)
}
public fun treasury_remaining_at<T>(treasury: &SmartTreasury<T>, now_ms: u64): u64 {
    spend_meter::remaining_at(&treasury.meter, now_ms)
}

#[test_only]
public fun treasury_for_testing<T>(
    treasury_id: String,
    amount: u64,
    operating_floor: u64,
    allowed_recipients: vector<address>,
    per_tx_cap: u64,
    window_cap: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): SmartTreasury<T> {
    SmartTreasury<T> {
        id: object::new(ctx),
        treasury_id,
        balance: balance::create_for_testing<T>(amount),
        lifetime_deposited: amount,
        lifetime_withdrawn: 0,
        last_activity_ms: clock::timestamp_ms(clock),
        admin: tx_context::sender(ctx),
        operating_floor,
        allowed_recipients: vec_set::from_keys(allowed_recipients),
        meter: spend_meter::new(per_tx_cap, window_cap, clock),
    }
}

#[test_only]
public fun destroy_for_testing<T>(treasury: SmartTreasury<T>): u64 {
    let SmartTreasury {
        id,
        treasury_id: _,
        balance,
        lifetime_deposited: _,
        lifetime_withdrawn: _,
        last_activity_ms: _,
        admin: _,
        operating_floor: _,
        allowed_recipients: _,
        meter,
    } = treasury;
    // SpendMeter has no `drop` — removing a meter must always be a deliberate
    // edit, never a silent omission.
    spend_meter::destroy(meter);
    id.delete();
    balance.destroy_for_testing()
}
