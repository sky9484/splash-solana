/// Window arithmetic that has never run is a guess.
///
/// splash_meter has no third-party dependencies specifically so `sui move test`
/// executes here — splash_custody's suite is still blocked by the pinned
/// DeepBook rev's own test files, and a spend ceiling whose boundary behaviour
/// is unverified is not a control.
///
/// The boundary cases below are the ones that decide whether the meter actually
/// bounds anything: the tumbling-window double-spend, the exact bucket edges,
/// and the relaxation step limit.
#[test_only]
module splash_meter::spend_meter_tests;

use splash_meter::guardian;
use splash_meter::spend_meter::{Self, SpendMeter};
use std::unit_test::assert_eq;
use sui::clock::{Self, Clock};
use sui::object;
use sui::test_scenario;

const OPERATOR: address = @0x09E7A;
const HOUR: u64 = 3_600_000;
const DAY: u64 = 86_400_000;

/// $50k/tx, $50k/24h in 6-decimal minor units.
const PER_TX: u64 = 50_000_000_000;
const WINDOW: u64 = 50_000_000_000;

fun fresh(ctx: &mut TxContext): (SpendMeter, Clock, object::ID) {
    let mut c = clock::create_for_testing(ctx);
    // Start at an exact bucket boundary so the arithmetic is unambiguous.
    c.set_for_testing(1_000 * DAY);
    let meter = spend_meter::new(PER_TX, WINDOW, &c);
    let id = object::id_from_address(@0xF00D);
    (meter, c, id)
}

fun cleanup(meter: SpendMeter, c: Clock) {
    spend_meter::destroy(meter);
    c.destroy_for_testing();
}

// ── The hot path ────────────────────────────────────────────────────────────

#[test]
fun charges_accumulate_inside_the_window() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, c, id) = fresh(scenario.ctx());

    spend_meter::charge(&mut meter, id, 10_000_000_000, &c);
    assert_eq!(spend_meter::window_spent_for_testing(&meter), 10_000_000_000);
    spend_meter::charge(&mut meter, id, 15_000_000_000, &c);
    assert_eq!(spend_meter::window_spent_for_testing(&meter), 25_000_000_000);
    assert_eq!(spend_meter::remaining_at(&meter, 1_000 * DAY), 25_000_000_000);

    cleanup(meter, c);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 901, location = splash_meter::spend_meter)]
fun a_single_charge_above_the_per_tx_cap_aborts() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, c, id) = fresh(scenario.ctx());
    spend_meter::charge(&mut meter, id, PER_TX + 1, &c);
    cleanup(meter, c);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 902, location = splash_meter::spend_meter)]
/// Many small charges must not sum past the window ceiling — the obvious way to
/// walk past a per-transaction-only limit.
fun many_small_charges_cannot_exceed_the_window() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, c, id) = fresh(scenario.ctx());
    let mut i = 0;
    // 10 x $5k = $50k exactly, then one more unit must fail.
    while (i < 10) {
        spend_meter::charge(&mut meter, id, 5_000_000_000, &c);
        i = i + 1;
    };
    assert_eq!(spend_meter::remaining_at(&meter, 1_000 * DAY), 0);
    spend_meter::charge(&mut meter, id, 1, &c);
    cleanup(meter, c);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 900, location = splash_meter::spend_meter)]
fun a_zero_charge_aborts() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, c, id) = fresh(scenario.ctx());
    spend_meter::charge(&mut meter, id, 0, &c);
    cleanup(meter, c);
    scenario.end();
}

// ── Window boundaries — the part that decides whether this bounds anything ──

#[test]
/// THE TUMBLING-WINDOW ATTACK, which is why this uses 24 buckets rather than a
/// single (window_start, spent) pair.
///
/// Against a tumbling window: spend the full ceiling at t = end - 1ms, wait 2ms,
/// spend the full ceiling again. Two blocks, 2x the advertised cap. Here the
/// window slides, so after 1 hour only ONE bucket has aged out and the attacker
/// recovers 1/24th of the ceiling, not all of it.
fun a_sliding_window_denies_the_tumbling_double_spend() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, mut c, id) = fresh(scenario.ctx());

    // Fill the whole window in hour 0.
    spend_meter::charge(&mut meter, id, WINDOW, &c);
    assert_eq!(spend_meter::remaining_at(&meter, 1_000 * DAY), 0);

    // One hour later, a tumbling window would have reset entirely.
    c.set_for_testing(1_000 * DAY + HOUR);
    // It has not: the spend still sits in a bucket inside the window.
    assert_eq!(spend_meter::remaining_at(&meter, 1_000 * DAY + HOUR), 0);

    // Even at 23 hours, 1 bucket short of a full turnover, nothing is freed —
    // the whole spend was in one bucket and that bucket is still in range.
    assert_eq!(spend_meter::remaining_at(&meter, 1_000 * DAY + 23 * HOUR), 0);

    cleanup(meter, c);
    scenario.end();
}

#[test]
/// Exactly one full window later, the ceiling is available again — the meter
/// bounds RATE, not lifetime total.
fun capacity_returns_after_a_full_window() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, mut c, id) = fresh(scenario.ctx());

    spend_meter::charge(&mut meter, id, WINDOW, &c);
    assert_eq!(spend_meter::remaining_at(&meter, 1_000 * DAY), 0);

    c.set_for_testing(1_000 * DAY + DAY);
    assert_eq!(spend_meter::remaining_at(&meter, 1_000 * DAY + DAY), WINDOW);
    // And a charge succeeds.
    spend_meter::charge(&mut meter, id, WINDOW, &c);

    cleanup(meter, c);
    scenario.end();
}

#[test]
/// Partial ageing: spend across two hours, then advance far enough that only the
/// FIRST bucket has left the window.
fun buckets_age_out_one_at_a_time() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, mut c, id) = fresh(scenario.ctx());

    spend_meter::charge(&mut meter, id, 20_000_000_000, &c);  // hour 0
    c.set_for_testing(1_000 * DAY + HOUR);
    spend_meter::charge(&mut meter, id, 20_000_000_000, &c);  // hour 1
    assert_eq!(spend_meter::window_spent_for_testing(&meter), 40_000_000_000);

    // 24h after hour 0: the hour-0 bucket has aged out, hour-1 has not.
    c.set_for_testing(1_000 * DAY + 24 * HOUR);
    spend_meter::charge(&mut meter, id, 1, &c);
    assert_eq!(spend_meter::window_spent_for_testing(&meter), 20_000_000_001);

    cleanup(meter, c);
    scenario.end();
}

#[test]
/// `remaining_at` must agree with what `charge` will actually allow.
///
/// It did not. The virtual roll counted buckets FORWARDS from the head, which
/// wraps onto the buckets a real roll is about to zero and skips the same
/// number of live ones. The error is invisible whenever the skipped bucket is
/// empty, which is why every existing test passed: they spend in the head
/// bucket or let the whole window turn over.
///
/// This case puts spend in the bucket immediately behind the head and then
/// queries one hour ahead. Before the fix it reported the full window free
/// while 40% of it was committed — an over-report, so the off-chain batcher
/// would size a payroll run the chain then refuses.
fun remaining_at_agrees_with_what_charge_allows() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, mut c, id) = fresh(scenario.ctx());

    spend_meter::charge(&mut meter, id, 20_000_000_000, &c);   // hour 0
    c.set_for_testing(1_000 * DAY + HOUR);
    spend_meter::charge(&mut meter, id, 1, &c);                // hour 1, head here

    // One hour on. Nothing has aged out — the window is 24 hours — so both
    // charges still count and exactly WINDOW - 20_000_000_001 is free.
    let quoted = spend_meter::remaining_at(&meter, 1_000 * DAY + 2 * HOUR);
    assert_eq!(quoted, WINDOW - 20_000_000_001);

    // And the quote is honest: charging exactly what it offered succeeds.
    c.set_for_testing(1_000 * DAY + 2 * HOUR);
    spend_meter::charge(&mut meter, id, quoted, &c);
    assert_eq!(spend_meter::remaining_at(&meter, 1_000 * DAY + 2 * HOUR), 0);

    cleanup(meter, c);
    scenario.end();
}

#[test]
/// A meter untouched for a month must not carry stale spend, and must not cost
/// unbounded gas to roll forward.
fun a_long_dormant_meter_resets_wholly() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, mut c, id) = fresh(scenario.ctx());

    spend_meter::charge(&mut meter, id, WINDOW, &c);
    c.set_for_testing(1_000 * DAY + 30 * DAY);
    assert_eq!(spend_meter::remaining_at(&meter, 1_000 * DAY + 30 * DAY), WINDOW);
    spend_meter::charge(&mut meter, id, WINDOW, &c);
    assert_eq!(spend_meter::window_spent_for_testing(&meter), WINDOW);

    cleanup(meter, c);
    scenario.end();
}

#[test]
/// Sub-bucket time movement must not roll anything: charges inside the same hour
/// accumulate into one bucket.
fun movement_within_a_bucket_does_not_roll() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, mut c, id) = fresh(scenario.ctx());

    spend_meter::charge(&mut meter, id, 10_000_000_000, &c);
    c.set_for_testing(1_000 * DAY + HOUR - 1);
    spend_meter::charge(&mut meter, id, 10_000_000_000, &c);
    assert_eq!(spend_meter::window_spent_for_testing(&meter), 20_000_000_000);

    cleanup(meter, c);
    scenario.end();
}

// ── Limit changes ───────────────────────────────────────────────────────────

#[test]
fun tightening_is_immediate() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, c, id) = fresh(scenario.ctx());

    spend_meter::tighten(&mut meter, id, 1_000_000_000, 5_000_000_000);
    assert_eq!(spend_meter::per_tx_cap(&meter), 1_000_000_000);
    assert_eq!(spend_meter::window_cap(&meter), 5_000_000_000);

    cleanup(meter, c);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 906, location = splash_meter::spend_meter)]
/// `tighten` must not be usable to raise a limit — that would route around the
/// 48h notice entirely.
fun tighten_cannot_raise() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, c, id) = fresh(scenario.ctx());
    spend_meter::tighten(&mut meter, id, PER_TX * 2, WINDOW * 2);
    cleanup(meter, c);
    scenario.end();
}

#[test]
/// A relaxation does NOT take effect on proposal, and does take effect after the
/// delay. This is the property an attacker with the money key runs into.
fun relaxation_waits_out_the_delay() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, mut c, id) = fresh(scenario.ctx());

    spend_meter::propose_relax(&mut meter, id, PER_TX * 2, WINDOW * 2, &c);
    // Still the old ceiling.
    assert_eq!(spend_meter::window_cap(&meter), WINDOW);
    assert!(spend_meter::has_pending(&meter), 0);

    // One hour before maturity — still old.
    c.set_for_testing(1_000 * DAY + spend_meter::relax_delay_ms() - 1);
    spend_meter::charge(&mut meter, id, 1, &c);
    assert_eq!(spend_meter::window_cap(&meter), WINDOW);

    // At maturity the next charge applies it lazily — no cron needed.
    c.set_for_testing(1_000 * DAY + spend_meter::relax_delay_ms());
    spend_meter::charge(&mut meter, id, 1, &c);
    assert_eq!(spend_meter::window_cap(&meter), WINDOW * 2);
    assert!(!spend_meter::has_pending(&meter), 1);

    cleanup(meter, c);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 905, location = splash_meter::spend_meter)]
/// The step limit. Without it, a compromised key proposes u64::MAX once and
/// waits two days — the delay would buy time but not bound the outcome.
fun a_relaxation_beyond_4x_aborts() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, c, id) = fresh(scenario.ctx());
    spend_meter::propose_relax(&mut meter, id, PER_TX * 4 + 1, WINDOW * 4 + 1, &c);
    cleanup(meter, c);
    scenario.end();
}

#[test]
/// Exactly 4x is allowed — the boundary is inclusive.
fun a_relaxation_of_exactly_4x_is_allowed() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, c, id) = fresh(scenario.ctx());
    spend_meter::propose_relax(&mut meter, id, PER_TX * 4, WINDOW * 4, &c);
    assert!(spend_meter::has_pending(&meter), 0);
    cleanup(meter, c);
    scenario.end();
}

#[test]
/// The 48h notice is only worth something if a watcher can act on it.
fun a_queued_relaxation_can_be_cancelled() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, mut c, id) = fresh(scenario.ctx());

    spend_meter::propose_relax(&mut meter, id, PER_TX * 2, WINDOW * 2, &c);
    spend_meter::cancel_relax(&mut meter, id);
    assert!(!spend_meter::has_pending(&meter), 0);

    // And it never lands, even long after it would have matured.
    c.set_for_testing(1_000 * DAY + 10 * DAY);
    spend_meter::charge(&mut meter, id, 1, &c);
    assert_eq!(spend_meter::window_cap(&meter), WINDOW);

    cleanup(meter, c);
    scenario.end();
}

#[test]
/// Tightening drops a queued raise. Otherwise an emergency tighten would be
/// undone automatically 48h later by a proposal the attacker had already made.
fun tightening_cancels_a_queued_relaxation() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, mut c, id) = fresh(scenario.ctx());

    spend_meter::propose_relax(&mut meter, id, PER_TX * 2, WINDOW * 2, &c);
    spend_meter::tighten(&mut meter, id, 1_000_000, 1_000_000);
    assert!(!spend_meter::has_pending(&meter), 0);

    c.set_for_testing(1_000 * DAY + 10 * DAY);
    spend_meter::charge(&mut meter, id, 1, &c);
    assert_eq!(spend_meter::window_cap(&meter), 1_000_000);

    cleanup(meter, c);
    scenario.end();
}

#[test]
/// Recovering from a defensive tighten is not a relaxation — the baseline was
/// agreed at mint. Without this, an over-tight emergency response costs 48h to
/// undo, which is the pressure that makes operators avoid tightening at all.
fun bootstrap_limits_restore_instantly() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, c, id) = fresh(scenario.ctx());

    spend_meter::tighten(&mut meter, id, 1, 1);
    assert_eq!(spend_meter::window_cap(&meter), 1);

    spend_meter::restore_bootstrap(&mut meter, id);
    assert_eq!(spend_meter::per_tx_cap(&meter), PER_TX);
    assert_eq!(spend_meter::window_cap(&meter), WINDOW);

    cleanup(meter, c);
    scenario.end();
}

#[test]
/// Restoring from an extreme tighten must not become a 4x-step bypass: the
/// restore is capped at bootstrap, and going ABOVE bootstrap still needs notice.
fun restore_cannot_exceed_bootstrap() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let (mut meter, c, id) = fresh(scenario.ctx());

    spend_meter::tighten(&mut meter, id, 1, 1);
    spend_meter::restore_bootstrap(&mut meter, id);
    let (boot_tx, boot_window) = spend_meter::bootstrap_caps(&meter);
    assert_eq!(spend_meter::per_tx_cap(&meter), boot_tx);
    assert_eq!(spend_meter::window_cap(&meter), boot_window);

    cleanup(meter, c);
    scenario.end();
}

// ── Pause ───────────────────────────────────────────────────────────────────

#[test]
#[expected_failure(abort_code = 903, location = splash_meter::spend_meter)]
/// One signature from one machine stops money movement. This is the control
/// that matters in the Step Finance scenario.
fun a_guardian_can_pause_and_charges_then_abort() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let ctx = scenario.ctx();
    let (mut meter, c, id) = fresh(ctx);
    let cap = guardian::mint_for_testing(id, ctx);

    spend_meter::guardian_pause(&mut meter, id, &cap);
    assert!(spend_meter::is_paused(&meter), 0);
    assert_eq!(spend_meter::remaining_at(&meter, 1_000 * DAY), 0);

    guardian::destroy(cap);
    spend_meter::charge(&mut meter, id, 1, &c);
    cleanup(meter, c);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 920, location = splash_meter::guardian)]
/// A guardian minted for one meter cannot pause another — a stolen cap stays
/// scoped to the object it watches.
fun a_guardian_cannot_pause_a_meter_it_does_not_watch() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let ctx = scenario.ctx();
    let (mut meter, c, id) = fresh(ctx);
    let other = object::id_from_address(@0xBEEF);
    let cap = guardian::mint_for_testing(other, ctx);

    spend_meter::guardian_pause(&mut meter, id, &cap);

    guardian::destroy(cap);
    cleanup(meter, c);
    scenario.end();
}

#[test]
/// The guardian stops; only the cold key restarts. `guardian.move` exposes no
/// unpause at all, so this is enforced by absence rather than by a check.
fun only_the_admin_path_can_unpause() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let ctx = scenario.ctx();
    let (mut meter, c, id) = fresh(ctx);
    let cap = guardian::mint_for_testing(id, ctx);

    spend_meter::guardian_pause(&mut meter, id, &cap);
    assert!(spend_meter::is_paused(&meter), 0);

    spend_meter::unpause(&mut meter, id);
    assert!(!spend_meter::is_paused(&meter), 1);
    spend_meter::charge(&mut meter, id, 1, &c);

    guardian::destroy(cap);
    cleanup(meter, c);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 909, location = splash_meter::spend_meter)]
/// A per-tx cap above the window cap is not a limit, it is a typo that reads
/// like one.
fun a_per_tx_cap_above_the_window_cap_is_rejected_at_mint() {
    let mut scenario = test_scenario::begin(OPERATOR);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000 * DAY);
    let meter = spend_meter::new(WINDOW + 1, WINDOW, &c);
    cleanup(meter, c);
    scenario.end();
}
