module splash_custody::dual_treasury;

use splash_core::business_account::{AdminCap, TreasuryCap};
use splash_meter::guardian::GuardianCap;
use splash_meter::spend_meter::{Self, SpendMeter};
use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;

const E_USDT_TTL_EXCEEDED: u64 = 600;
const E_USDT_BUFFER_EMPTY: u64 = 601;
const E_USDT_SWEEP_TOO_EARLY: u64 = 602;
const E_USDT_INSUFFICIENT_KYC_TIER: u64 = 603;
const E_USDT_INSUFFICIENT_BALANCE: u64 = 604;
const E_USDT_ACTIVE_BUFFER: u64 = 605;
const E_USDT_ZERO_AMOUNT: u64 = 606;
const E_USDT_INVALID_RECIPIENT: u64 = 607;
/// Lowering the stored KYC floor requires the buffer to be paused first.
const E_USDT_REQUIRES_PAUSE:   u64 = 608;
const USDT_MAX_HOLD_MS: u64 = 1_800_000;
const USDT_SWEEP_TRIGGER_MS: u64 = 1_620_000;

public struct UsdtBuffer<phantom USDT> has key {
    id: UID,
    balance: Balance<USDT>,
    intake_ms: u64,
    intake_amount: u64,
    /// FIXED at creation. `emergency_sweep` used to take the destination as an
    /// argument, so a compromised `AdminCap` could sweep the entire buffer to an
    /// address of its choosing — and in the event log that is indistinguishable
    /// from a legitimate sweep. The sweep destination is a property of the
    /// buffer, decided at the ceremony.
    sweep_recipient: address,
    /// STORED, not caller-supplied.
    ///
    /// `settle_usdt` asserted `kyc_tier >= min_kyc_tier` with BOTH sides passed
    /// in by the caller. Pass `kyc_tier: 5, min_kyc_tier: 0` and it always
    /// passes — a compliance gate that enforces whatever the caller wants it to.
    /// The threshold now lives on the buffer, so the assert compares a
    /// caller-supplied claim against a stored policy.
    min_kyc_tier: u8,
    /// Velocity ceiling (A-11).
    meter: SpendMeter,
}

public struct UsdtDeposited has copy, drop {
    amount: u64,
    intake_ms: u64,
    expires_at_ms: u64,
}

public struct UsdtSettled has copy, drop {
    payout_id: vector<u8>,
    amount: u64,
    age_ms: u64,
    recipient: address,
}

public struct UsdtSwept has copy, drop {
    amount: u64,
    age_ms: u64,
}

public fun create_buffer<USDT>(
    _: &AdminCap,
    sweep_recipient: address,
    min_kyc_tier: u8,
    per_tx_cap: u64,
    window_cap: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): UsdtBuffer<USDT> {
    assert!(sweep_recipient != @0x0, E_USDT_INVALID_RECIPIENT);
    UsdtBuffer {
        id: object::new(ctx),
        balance: balance::zero(),
        intake_ms: 0,
        intake_amount: 0,
        sweep_recipient,
        min_kyc_tier,
        meter: spend_meter::new(per_tx_cap, window_cap, clock),
    }
}

/// Share a freshly-created buffer so it becomes a shared object that
/// `deposit`/`settle_usdt`/`emergency_sweep` (all of which take
/// `&mut UsdtBuffer`) can reference from a PTB.
///
/// `UsdtBuffer` only has the `key` ability (no `store`), so it cannot be
/// shared with `transfer::public_share_object` from outside this module —
/// without this entry the object returned by `create_buffer` could never be
/// persisted or used. Compose in one PTB: create_buffer → share_buffer.
public fun share_buffer<USDT>(buffer: UsdtBuffer<USDT>) {
    transfer::share_object(buffer);
}

/// Convenience: create the buffer and share it in a single call.
public fun create_and_share_buffer<USDT>(
    admin: &AdminCap,
    sweep_recipient: address,
    min_kyc_tier: u8,
    per_tx_cap: u64,
    window_cap: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    share_buffer(create_buffer<USDT>(
        admin, sweep_recipient, min_kyc_tier, per_tx_cap, window_cap, clock, ctx,
    ));
}

public fun deposit<USDT>(
    buffer: &mut UsdtBuffer<USDT>,
    coin: Coin<USDT>,
    clock: &Clock,
    _admin: &AdminCap,
) {
    let amount = coin::value(&coin);
    let now_ms = clock::timestamp_ms(clock);

    assert!(amount > 0, E_USDT_ZERO_AMOUNT);
    assert!(balance::value(&buffer.balance) == 0, E_USDT_ACTIVE_BUFFER);

    balance::join(&mut buffer.balance, coin::into_balance(coin));
    buffer.intake_ms = now_ms;
    buffer.intake_amount = amount;

    event::emit(UsdtDeposited {
        amount,
        intake_ms: now_ms,
        expires_at_ms: now_ms + USDT_MAX_HOLD_MS,
    });
}

public fun settle_usdt<USDT>(
    buffer: &mut UsdtBuffer<USDT>,
    _treasury: &TreasuryCap,
    recipient: address,
    amount: u64,
    payout_id: vector<u8>,
    kyc_tier: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(amount > 0, E_USDT_ZERO_AMOUNT);
    assert!(recipient != @0x0, E_USDT_INVALID_RECIPIENT);
    // The threshold is READ FROM THE BUFFER. It used to be a parameter next to
    // `kyc_tier`, which made the comparison caller-versus-caller and therefore
    // no gate at all.
    assert!(kyc_tier >= buffer.min_kyc_tier, E_USDT_INSUFFICIENT_KYC_TIER);

    let balance_value = balance::value(&buffer.balance);
    assert!(balance_value > 0, E_USDT_BUFFER_EMPTY);
    assert!(buffer.intake_ms > 0, E_USDT_BUFFER_EMPTY);

    let age_ms = buffer_age_ms(buffer, clock);
    assert!(age_ms < USDT_MAX_HOLD_MS, E_USDT_TTL_EXCEEDED);
    assert!(balance_value >= amount, E_USDT_INSUFFICIENT_BALANCE);

    let buffer_id = object::id(buffer);
    spend_meter::charge(&mut buffer.meter, buffer_id, amount, clock);

    let coin = coin::from_balance(balance::split(&mut buffer.balance, amount), ctx);
    transfer::public_transfer(coin, recipient);

    if (balance::value(&buffer.balance) == 0) {
        buffer.intake_ms = 0;
        buffer.intake_amount = 0;
    };

    event::emit(UsdtSettled { payout_id, amount, age_ms, recipient });
}

/// Sweep a stale buffer to the destination fixed at creation.
///
/// The `recipient` argument is gone. A caller-supplied destination on an
/// emergency path is the worst combination available: it moves the WHOLE
/// balance, it is reachable precisely when things are already going wrong, and
/// in the event log a redirected sweep is indistinguishable from a legitimate
/// one.
public fun emergency_sweep<USDT>(
    buffer: &mut UsdtBuffer<USDT>,
    _treasury: &TreasuryCap,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let recipient = buffer.sweep_recipient;
    let amount = balance::value(&buffer.balance);
    assert!(amount > 0, E_USDT_BUFFER_EMPTY);
    assert!(buffer.intake_ms > 0, E_USDT_BUFFER_EMPTY);

    let age_ms = buffer_age_ms(buffer, clock);
    assert!(age_ms >= USDT_SWEEP_TRIGGER_MS, E_USDT_SWEEP_TOO_EARLY);

    let buffer_id = object::id(buffer);
    spend_meter::charge(&mut buffer.meter, buffer_id, amount, clock);

    let coin = coin::from_balance(balance::split(&mut buffer.balance, amount), ctx);
    buffer.intake_ms = 0;
    buffer.intake_amount = 0;

    event::emit(UsdtSwept { amount, age_ms });
    transfer::public_transfer(coin, recipient);
}

public fun usdt_balance<USDT>(buffer: &UsdtBuffer<USDT>): u64 {
    balance::value(&buffer.balance)
}

public fun usdt_age_ms<USDT>(buffer: &UsdtBuffer<USDT>, clock: &Clock): u64 {
    buffer_age_ms(buffer, clock)
}

public fun ttl_remaining_ms<USDT>(buffer: &UsdtBuffer<USDT>, clock: &Clock): u64 {
    let age = usdt_age_ms(buffer, clock);
    if (age >= USDT_MAX_HOLD_MS) { 0 } else { USDT_MAX_HOLD_MS - age }
}

/// Raising the KYC floor is tightening — instant. Lowering it admits payouts
/// that were previously refused, so it needs a pause first.
public fun set_min_kyc_tier<USDT>(_admin: &AdminCap, buffer: &mut UsdtBuffer<USDT>, tier: u8) {
    if (tier < buffer.min_kyc_tier) {
        assert!(spend_meter::is_paused(&buffer.meter), E_USDT_REQUIRES_PAUSE);
    };
    buffer.min_kyc_tier = tier;
}

public fun tighten_buffer_limits<USDT>(
    _admin: &AdminCap,
    buffer: &mut UsdtBuffer<USDT>,
    per_tx_cap: u64,
    window_cap: u64,
) {
    let id = object::id(buffer);
    spend_meter::tighten(&mut buffer.meter, id, per_tx_cap, window_cap);
}

public fun propose_buffer_relax<USDT>(
    _admin: &AdminCap,
    buffer: &mut UsdtBuffer<USDT>,
    per_tx_cap: u64,
    window_cap: u64,
    clock: &Clock,
) {
    let id = object::id(buffer);
    spend_meter::propose_relax(&mut buffer.meter, id, per_tx_cap, window_cap, clock);
}

public fun guardian_pause_buffer<USDT>(buffer: &mut UsdtBuffer<USDT>, cap: &GuardianCap) {
    let id = object::id(buffer);
    spend_meter::guardian_pause(&mut buffer.meter, id, cap);
}

public fun unpause_buffer<USDT>(_admin: &AdminCap, buffer: &mut UsdtBuffer<USDT>) {
    let id = object::id(buffer);
    spend_meter::unpause(&mut buffer.meter, id);
}

public fun mint_buffer_guardian<USDT>(
    _admin: &AdminCap,
    buffer: &UsdtBuffer<USDT>,
    holder: address,
    ctx: &mut TxContext,
) {
    spend_meter::mint_guardian(&buffer.meter, object::id(buffer), holder, ctx);
}

public fun sweep_recipient<USDT>(buffer: &UsdtBuffer<USDT>): address { buffer.sweep_recipient }
public fun min_kyc_tier<USDT>(buffer: &UsdtBuffer<USDT>): u8 { buffer.min_kyc_tier }
public fun buffer_remaining_at<USDT>(buffer: &UsdtBuffer<USDT>, now_ms: u64): u64 {
    spend_meter::remaining_at(&buffer.meter, now_ms)
}

public fun sweep_trigger_ms(): u64 {
    USDT_SWEEP_TRIGGER_MS
}

public fun max_hold_ms(): u64 {
    USDT_MAX_HOLD_MS
}

fun buffer_age_ms<USDT>(buffer: &UsdtBuffer<USDT>, clock: &Clock): u64 {
    if (buffer.intake_ms == 0) {
        0
    } else {
        let now_ms = clock::timestamp_ms(clock);
        if (now_ms > buffer.intake_ms) { now_ms - buffer.intake_ms } else { 0 }
    }
}
