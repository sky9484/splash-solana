/// SpendMeter — a velocity ceiling on money leaving a custodial object.
///
/// AUDIT A-11. Nothing bounded an `AdminCap` call: `withdraw_fees`,
/// `smart_treasury::withdraw`, `allocate` (whose floor was a CALLER-SUPPLIED
/// argument — pass 0 and it evaporates) and `settle_batch` would each move an
/// unbounded amount. One transaction signed with the money key drained the pool,
/// the accrued fees and the treasury.
///
/// That is the Step Finance shape (January 2026, ~$30-40M): compromised
/// executive devices, legitimate admin controls, no contract bug anywhere. A
/// perfect contract does not help if one signature can move everything.
///
/// ─── The window ─────────────────────────────────────────────────────────────
///
/// Twenty-four hourly buckets, rolled forward lazily by the spender's own
/// transaction. Sui has no cron, so nothing can be scheduled to reset a counter;
/// any design that needs one is a design that silently stops working when nobody
/// calls it.
///
/// Buckets rather than a single `(window_start, spent)` pair, because a TUMBLING
/// window with lazy reset is trivially defeated: spend the full ceiling at
/// `t = end - 1ms`, and again at `t = end + 1ms`. Two blocks, 2x the advertised
/// cap. Twenty-four buckets make the window genuinely sliding at one-hour
/// granularity, so that trick buys at most one bucket of slack.
///
/// ─── Asymmetric limit changes ───────────────────────────────────────────────
///
/// TIGHTENING is instant — you never want to wait to reduce exposure.
/// RELAXING costs 48h of public `LimitsProposed` notice and is capped at 4x per
/// step. An attacker holding the money key cannot raise their own ceiling and
/// drain in the same transaction; they must announce it two days early, on
/// chain, in an event anyone can watch. The delay is a DETECTION window, not a
/// cryptographic guarantee — worthless if nobody watches, which is why the
/// event exists and why the runbook alerts on it.
module splash_meter::spend_meter;

use splash_meter::guardian::{Self, GuardianCap};
use sui::clock::{Self, Clock};
use sui::event;

// ─── Abort codes (900-block, reserved for splash_meter) ─────────────────────
const E_ZERO_AMOUNT:       u64 = 900;
const E_PER_TX_CAP:        u64 = 901;
/// The spend would push cumulative outflow past this window's ceiling. Aborts
/// the WHOLE transaction — a partially-paid payroll is worse than none.
const E_WINDOW_CAP:        u64 = 902;
const E_PAUSED:            u64 = 903;
const E_NOT_A_RELAX:       u64 = 904;
const E_RELAX_TOO_LARGE:   u64 = 905;
const E_NOT_A_TIGHTEN:     u64 = 906;
const E_NO_PENDING:        u64 = 907;
const E_RELAX_NOT_DUE:     u64 = 908;
const E_INVALID_LIMITS:    u64 = 909;
const E_ABOVE_BOOTSTRAP:   u64 = 910;
const E_NOT_PAUSED:        u64 = 911;

// ─── Window shape: CONSTANTS, not parameters ────────────────────────────────
// Deliberately not configurable at mint. A configurable window is a
// configurable bypass, and "what is the ceiling?" should be answerable by
// reading this file rather than by reading a shared object's current state.
const BUCKETS: u64 = 24;
const BUCKET_MS: u64 = 3_600_000;
const WINDOW_MS: u64 = 86_400_000;

/// A relaxation takes effect 48h after it is proposed.
const RELAX_DELAY_MS: u64 = 172_800_000;
/// And may at most quadruple a limit in one step. Ten steps to go from $50k to
/// $50M, each with its own 48h notice — enough that an exfiltration ramp is
/// visible long before it matters.
const MAX_RELAX_FACTOR: u64 = 4;

/// A pending relaxation. `drop` so replacing one is a plain overwrite.
public struct PendingRelax has store, drop {
    per_tx_cap: u64,
    window_cap: u64,
    effective_at_ms: u64,
}

/// Deliberately NOT `drop`: a meter must be explicitly destroyed, so removing
/// one from a custodial struct is a visible edit rather than a silent omission.
public struct SpendMeter has store {
    buckets: vector<u64>,
    /// Index of the bucket `head_start_ms` refers to.
    head: u64,
    /// Start-of-bucket timestamp for `head`.
    head_start_ms: u64,
    per_tx_cap: u64,
    window_cap: u64,
    /// Mint-time limits. A tightened meter can be restored to these in ONE
    /// transaction with no delay — going back to the agreed baseline after an
    /// incident is not a relaxation. Going ABOVE them still costs 48h.
    bootstrap_per_tx_cap: u64,
    bootstrap_window_cap: u64,
    pending: Option<PendingRelax>,
    paused: bool,
}

// ─── Events ─────────────────────────────────────────────────────────────────

public struct MeterCharged has copy, drop {
    meter_id: ID,
    amount: u64,
    /// Cumulative spend in the window INCLUDING this charge. Monitoring alerts
    /// when this crosses a fraction of `window_cap` — the early warning that a
    /// key is being exercised harder than the business explains.
    window_spent: u64,
    window_cap: u64,
    at_ms: u64,
}

/// Security-critical. Any relaxation the team did not initiate is a compromise
/// signal with 48h of runway on it.
public struct LimitsProposed has copy, drop {
    meter_id: ID,
    from_per_tx_cap: u64,
    from_window_cap: u64,
    to_per_tx_cap: u64,
    to_window_cap: u64,
    effective_at_ms: u64,
}

public struct LimitsApplied has copy, drop {
    meter_id: ID,
    per_tx_cap: u64,
    window_cap: u64,
    /// `true` when this was an instant tighten or bootstrap restore rather than
    /// a matured proposal.
    immediate: bool,
}

public struct MeterPaused has copy, drop { meter_id: ID, by_guardian: bool }
public struct MeterUnpaused has copy, drop { meter_id: ID }

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/// A meter is a `store` field, not an object, so it has no id of its own. Every
/// mutating call takes the OWNING object's id instead — that is what scopes a
/// `GuardianCap` to one pool, and it is passed rather than stored so the two can
/// never drift apart.
public fun new(per_tx_cap: u64, window_cap: u64, clock: &Clock): SpendMeter {
    assert!(per_tx_cap > 0 && window_cap > 0, E_INVALID_LIMITS);
    // A per-tx cap above the window cap is not a limit, it is a typo that reads
    // like a limit.
    assert!(per_tx_cap <= window_cap, E_INVALID_LIMITS);

    let now = clock::timestamp_ms(clock);
    let mut buckets = vector::empty<u64>();
    let mut i = 0;
    while (i < BUCKETS) {
        buckets.push_back(0);
        i = i + 1;
    };

    SpendMeter {
        buckets,
        head: 0,
        head_start_ms: bucket_start(now),
        per_tx_cap,
        window_cap,
        bootstrap_per_tx_cap: per_tx_cap,
        bootstrap_window_cap: window_cap,
        pending: option::none(),
        paused: false,
    }
}

/// Explicit teardown. `SpendMeter` has no `drop`, so a struct that holds one
/// cannot be silently discarded — removing a meter is always a deliberate edit.
public fun destroy(meter: SpendMeter) {
    let SpendMeter {
        buckets: _,
        head: _,
        head_start_ms: _,
        per_tx_cap: _,
        window_cap: _,
        bootstrap_per_tx_cap: _,
        bootstrap_window_cap: _,
        pending: _,
        paused: _,
    } = meter;
}

// ─── The window ─────────────────────────────────────────────────────────────

fun bucket_start(now_ms: u64): u64 {
    now_ms - (now_ms % BUCKET_MS)
}

/// Advance the window to `now`, zeroing buckets that have aged out.
///
/// Gas is bounded at `BUCKETS` writes worst case, and the whole-window reset
/// short-circuits: a meter untouched for a month costs the same as one
/// untouched for a day.
fun roll_forward(meter: &mut SpendMeter, now_ms: u64) {
    let now_start = bucket_start(now_ms);
    if (now_start <= meter.head_start_ms) return;

    let elapsed = (now_start - meter.head_start_ms) / BUCKET_MS;
    if (elapsed >= BUCKETS) {
        // The entire window has turned over. Nothing carries.
        let mut i = 0;
        while (i < BUCKETS) {
            *meter.buckets.borrow_mut(i) = 0;
            i = i + 1;
        };
        meter.head = 0;
    } else {
        let mut step = 0;
        while (step < elapsed) {
            meter.head = (meter.head + 1) % BUCKETS;
            *meter.buckets.borrow_mut(meter.head) = 0;
            step = step + 1;
        };
    };
    meter.head_start_ms = now_start;
}

/// Apply a matured relaxation. Lazy, because there is no cron to call it — the
/// next spend (or query) is what makes a proposal take effect.
fun apply_pending(meter: &mut SpendMeter, now_ms: u64) {
    if (meter.pending.is_none()) return;
    let due = meter.pending.borrow().effective_at_ms;
    if (now_ms < due) return;

    let relax = meter.pending.extract();
    meter.per_tx_cap = relax.per_tx_cap;
    meter.window_cap = relax.window_cap;
}

fun window_spent(meter: &SpendMeter): u64 {
    let mut total = 0;
    let mut i = 0;
    while (i < BUCKETS) {
        total = total + *meter.buckets.borrow(i);
        i = i + 1;
    };
    total
}

// ─── The hot path ───────────────────────────────────────────────────────────

/// Charge `amount` against the meter, or abort.
///
/// ─── Why `public` is safe here ──────────────────────────────────────────────
///
/// A `SpendMeter` is not an object; it is a `store` FIELD of the custodial
/// struct that owns it (`SettlementPool.payout_meter`,
/// `PayoutDelegation.meter`). Move makes struct fields private to their
/// defining module, so `&mut pool.payout_meter` can only be borrowed inside
/// `settlement.move` — and that module gates every borrow behind `AdminCap`, a
/// live delegation, or a `GuardianCap`.
///
/// The mutable reference IS the capability. There is no way for an unrelated
/// caller to obtain one, so a `public` charge cannot be used to burn a victim's
/// window or censor them. `public(package)` was tried first and does not work at
/// all: it means "this package only", and the consumer is a DIFFERENT package.
public fun charge(meter: &mut SpendMeter, meter_id: ID, amount: u64, clock: &Clock) {
    assert!(amount > 0, E_ZERO_AMOUNT);

    let now = clock::timestamp_ms(clock);
    roll_forward(meter, now);
    apply_pending(meter, now);

    assert!(!meter.paused, E_PAUSED);
    assert!(amount <= meter.per_tx_cap, E_PER_TX_CAP);

    let spent = window_spent(meter);
    // Written as a subtraction rather than `spent + amount <= cap` so a large
    // amount cannot overflow u64 before the comparison happens.
    assert!(amount <= meter.window_cap - spent, E_WINDOW_CAP);

    let head = meter.head;
    *meter.buckets.borrow_mut(head) = *meter.buckets.borrow(head) + amount;

    event::emit(MeterCharged {
        meter_id,
        amount,
        window_spent: spent + amount,
        window_cap: meter.window_cap,
        at_ms: now,
    });
}

/// How much may still be spent in the current window. Read-only, so it takes a
/// snapshot rather than mutating — the off-chain batcher uses this to split a
/// payroll run instead of discovering the ceiling by aborting.
public fun remaining_at(meter: &SpendMeter, now_ms: u64): u64 {
    if (meter.paused) return 0;

    // Mirror roll_forward WITHOUT mutating: count only buckets still inside the
    // window as of `now_ms`.
    let now_start = bucket_start(now_ms);
    if (now_start > meter.head_start_ms) {
        let elapsed = (now_start - meter.head_start_ms) / BUCKET_MS;
        if (elapsed >= BUCKETS) return effective_window_cap(meter, now_ms);
        // Buckets that survive are those NOT overwritten by the roll: the
        // newest `BUCKETS - elapsed`, counted BACKWARDS from the head.
        //
        // Counting FORWARDS from the head — which this did until the Phase 6
        // review — wraps onto the `elapsed` oldest buckets, exactly the ones
        // the roll is about to zero, and skips the same number of live ones.
        // The error hides whenever the skipped bucket is empty, and shows as
        // an OVER-report of free capacity when it is not, so the off-chain
        // batcher sizes a run the chain then refuses. `charge` was never
        // affected: it calls the real `roll_forward` and sums all 24.
        let mut total = 0;
        let mut j = 0;
        while (j < BUCKETS - elapsed) {
            let idx = (meter.head + BUCKETS - j) % BUCKETS;
            total = total + *meter.buckets.borrow(idx);
            j = j + 1;
        };
        let cap = effective_window_cap(meter, now_ms);
        return if (total >= cap) 0 else cap - total
    };

    let spent = window_spent(meter);
    let cap = effective_window_cap(meter, now_ms);
    if (spent >= cap) 0 else cap - spent
}

/// The cap that WILL apply at `now_ms`, accounting for a matured-but-unapplied
/// proposal. Without this, `remaining_at` would under-report right after a
/// relaxation matured and the batcher would split runs it did not need to.
fun effective_window_cap(meter: &SpendMeter, now_ms: u64): u64 {
    if (meter.pending.is_some() && now_ms >= meter.pending.borrow().effective_at_ms) {
        meter.pending.borrow().window_cap
    } else {
        meter.window_cap
    }
}

// ─── Limit changes ──────────────────────────────────────────────────────────

/// Reduce a limit. Immediate, and it may not be used to raise either field.
public fun tighten(meter: &mut SpendMeter, meter_id: ID, per_tx_cap: u64, window_cap: u64) {
    assert!(per_tx_cap > 0 && window_cap > 0, E_INVALID_LIMITS);
    assert!(per_tx_cap <= meter.per_tx_cap && window_cap <= meter.window_cap, E_NOT_A_TIGHTEN);
    assert!(per_tx_cap <= window_cap, E_INVALID_LIMITS);

    meter.per_tx_cap = per_tx_cap;
    meter.window_cap = window_cap;
    // A pending relaxation is dropped: tightening while a raise is queued and
    // letting the raise land anyway would make the tighten theatre.
    if (meter.pending.is_some()) { let _ = meter.pending.extract(); };

    event::emit(LimitsApplied { meter_id, per_tx_cap, window_cap, immediate: true });
}

/// Restore the mint-time limits in one transaction, no delay.
///
/// Recovering from a defensive tighten is not a relaxation — the baseline was
/// already agreed when the meter was minted. Without this, an over-tight
/// emergency response would cost 48h to undo, which is exactly the pressure
/// that makes operators avoid tightening at all.
public fun restore_bootstrap(meter: &mut SpendMeter, meter_id: ID) {
    meter.per_tx_cap = meter.bootstrap_per_tx_cap;
    meter.window_cap = meter.bootstrap_window_cap;
    if (meter.pending.is_some()) { let _ = meter.pending.extract(); };
    event::emit(LimitsApplied {
        meter_id,
        per_tx_cap: meter.per_tx_cap,
        window_cap: meter.window_cap,
        immediate: true,
    });
}

/// Queue a relaxation. Takes effect `RELAX_DELAY_MS` later, capped at 4x.
public fun propose_relax(
    meter: &mut SpendMeter,
    meter_id: ID,
    per_tx_cap: u64,
    window_cap: u64,
    clock: &Clock,
) {
    let now = clock::timestamp_ms(clock);
    apply_pending(meter, now);

    assert!(per_tx_cap > 0 && window_cap > 0, E_INVALID_LIMITS);
    assert!(per_tx_cap <= window_cap, E_INVALID_LIMITS);
    assert!(per_tx_cap >= meter.per_tx_cap && window_cap >= meter.window_cap, E_NOT_A_RELAX);
    // Above bootstrap, the step limit applies. This is what stops a compromised
    // key going from $50k to u64::MAX in one proposal and waiting two days.
    assert!(
        per_tx_cap <= meter.per_tx_cap * MAX_RELAX_FACTOR
            && window_cap <= meter.window_cap * MAX_RELAX_FACTOR,
        E_RELAX_TOO_LARGE,
    );

    let effective_at_ms = now + RELAX_DELAY_MS;
    event::emit(LimitsProposed {
        meter_id,
        from_per_tx_cap: meter.per_tx_cap,
        from_window_cap: meter.window_cap,
        to_per_tx_cap: per_tx_cap,
        to_window_cap: window_cap,
        effective_at_ms,
    });
    meter.pending = option::some(PendingRelax { per_tx_cap, window_cap, effective_at_ms });
}

/// Cancel a queued relaxation. The whole point of the 48h notice is that
/// somebody watching can stop it.
public fun cancel_relax(meter: &mut SpendMeter, meter_id: ID) {
    assert!(meter.pending.is_some(), E_NO_PENDING);
    let _ = meter.pending.extract();
    event::emit(LimitsApplied {
        meter_id,
        per_tx_cap: meter.per_tx_cap,
        window_cap: meter.window_cap,
        immediate: true,
    });
}

/// Force a matured proposal to land without waiting for the next spend. Only
/// useful for making state legible; `charge_internal` applies it anyway.
public fun apply_matured(meter: &mut SpendMeter, meter_id: ID, clock: &Clock) {
    let now = clock::timestamp_ms(clock);
    assert!(meter.pending.is_some(), E_NO_PENDING);
    assert!(now >= meter.pending.borrow().effective_at_ms, E_RELAX_NOT_DUE);
    apply_pending(meter, now);
    event::emit(LimitsApplied {
        meter_id,
        per_tx_cap: meter.per_tx_cap,
        window_cap: meter.window_cap,
        immediate: false,
    });
}

/// Guard against a bootstrap that was itself set too high — the consuming
/// package asserts this at mint so a typo cannot become the permanent ceiling.
public fun assert_within_bootstrap(meter: &SpendMeter, per_tx_cap: u64, window_cap: u64) {
    assert!(
        per_tx_cap <= meter.bootstrap_per_tx_cap && window_cap <= meter.bootstrap_window_cap,
        E_ABOVE_BOOTSTRAP,
    );
}

// ─── Pause ──────────────────────────────────────────────────────────────────

/// One signature, one machine, immediate. See `guardian.move` for why this is
/// deliberately available to a host that holds no money authority at all.
public fun guardian_pause(meter: &mut SpendMeter, meter_id: ID, cap: &GuardianCap) {
    guardian::assert_watches(cap, meter_id);
    meter.paused = true;
    event::emit(MeterPaused { meter_id, by_guardian: true });
}

/// Mint a guardian for THIS meter.
///
/// The `&SpendMeter` IS the authority. It can only be borrowed out of the
/// custodial struct that owns it, and Move makes struct fields private to their
/// defining module — so only `settlement.move` can produce this argument, and it
/// does so behind `AdminCap`. The gate cannot live in `guardian.move` itself:
/// that module cannot import this one, because this one already imports it.
public fun mint_guardian(_meter: &SpendMeter, meter_id: ID, holder: address, ctx: &mut TxContext) {
    guardian::mint_and_transfer(meter_id, holder, ctx);
}

public fun admin_pause(meter: &mut SpendMeter, meter_id: ID) {
    meter.paused = true;
    event::emit(MeterPaused { meter_id, by_guardian: false });
}

/// Resuming is NOT a guardian power — restarting money movement belongs to the
/// cold key. The consuming package gates this on `AdminCap`; reaching the meter
/// at all requires borrowing it out of the pool, which only that module can do.
public fun unpause(meter: &mut SpendMeter, meter_id: ID) {
    assert!(meter.paused, E_NOT_PAUSED);
    meter.paused = false;
    event::emit(MeterUnpaused { meter_id });
}

// ─── Views ──────────────────────────────────────────────────────────────────

public fun per_tx_cap(meter: &SpendMeter): u64 { meter.per_tx_cap }
public fun window_cap(meter: &SpendMeter): u64 { meter.window_cap }
public fun is_paused(meter: &SpendMeter): bool { meter.paused }
public fun has_pending(meter: &SpendMeter): bool { meter.pending.is_some() }
public fun pending_effective_at(meter: &SpendMeter): u64 {
    if (meter.pending.is_some()) meter.pending.borrow().effective_at_ms else 0
}
public fun bootstrap_caps(meter: &SpendMeter): (u64, u64) {
    (meter.bootstrap_per_tx_cap, meter.bootstrap_window_cap)
}
public fun window_ms(): u64 { WINDOW_MS }
public fun buckets(): u64 { BUCKETS }
public fun relax_delay_ms(): u64 { RELAX_DELAY_MS }
public fun max_relax_factor(): u64 { MAX_RELAX_FACTOR }

#[test_only]
public fun window_spent_for_testing(meter: &SpendMeter): u64 { window_spent(meter) }
