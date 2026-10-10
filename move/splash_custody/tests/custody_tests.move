/// Custody-side tests.
///
/// Requires Sui CLI >= 1.61.1 — see `Move.toml` for why, and for what was
/// verified when the DeepBook pin moved.
#[test_only]
module splash_custody::custody_tests;

use splash_core::business_account;
use splash_custody::smart_treasury;
use std::unit_test::assert_eq;
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario;

const ADMIN: address = @0xAD31;
const PAYEE: address = @0xBEEF;
const OUTSIDER: address = @0xBADBAD;
const DAY: u64 = 86_400_000;

const PER_TX: u64 = 10_000_000_000;
const WINDOW: u64 = 10_000_000_000;

fun treasury(ctx: &mut TxContext, c: &clock::Clock, funded: u64, floor: u64): smart_treasury::SmartTreasury<SUI> {
    smart_treasury::treasury_for_testing<SUI>(
        b"treasury-sui".to_string(),
        funded,
        floor,
        vector[PAYEE],
        PER_TX,
        WINDOW,
        c,
        ctx,
    )
}

#[test]
/// M3. `deposit` is AdminCap-gated and records the funding. It used to be open
/// to anyone with no record of who funded the pool, which made the pool
/// unreconcilable and gave an obvious layering path into a shared object that
/// pays third parties.
fun deposit_records_the_funding() {
    let mut scenario = test_scenario::begin(ADMIN);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000 * DAY);

    let mut t = treasury(ctx, &c, 0, 0);
    let funding = coin::mint_for_testing<SUI>(5_000, ctx);
    smart_treasury::deposit(&mut t, funding, &c, ctx);
    assert_eq!(smart_treasury::balance(&t), 5_000);

    let leftover = smart_treasury::destroy_for_testing(t);
    assert_eq!(leftover, 5_000);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 703, location = splash_custody::smart_treasury)]
/// THE A-11 EDGE, closed.
///
/// `allocate` used to take `operating_minimum` as an ARGUMENT and assert
/// `balance - amount >= operating_minimum`. Both sides came from the caller, so
/// passing 0 erased the floor — a guard that reads like a control and enforces
/// nothing. `allocate` is deleted; `withdraw` reads the floor from the treasury.
fun the_stored_operating_floor_cannot_be_argued_away() {
    let mut scenario = test_scenario::begin(ADMIN);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000 * DAY);

    let admin = business_account::admin_cap_for_testing(ctx);
    let treasury = business_account::treasury_cap_for_testing(ctx);
    // 1,000 funded, floor of 500. Withdrawing 600 would leave 400.
    let mut t = treasury(ctx, &c, 1_000, 500);
    smart_treasury::withdraw(&mut t, &treasury, PAYEE, 600, &c, ctx);

    sui::test_utils::destroy(admin);
    sui::test_utils::destroy(treasury);
    let _ = smart_treasury::destroy_for_testing(t);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 704, location = splash_custody::smart_treasury)]
/// A caller-supplied destination means a compromised AdminCap moves the balance
/// anywhere in one transaction. Withdrawals go only to allowlisted addresses.
fun withdrawals_only_reach_allowlisted_recipients() {
    let mut scenario = test_scenario::begin(ADMIN);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000 * DAY);

    let admin = business_account::admin_cap_for_testing(ctx);
    let treasury = business_account::treasury_cap_for_testing(ctx);
    let mut t = treasury(ctx, &c, 5_000, 0);
    smart_treasury::withdraw(&mut t, &treasury, OUTSIDER, 100, &c, ctx);

    sui::test_utils::destroy(admin);
    sui::test_utils::destroy(treasury);
    let _ = smart_treasury::destroy_for_testing(t);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 901, location = splash_meter::spend_meter)]
/// The treasury is metered like the settlement pool: one transaction cannot
/// empty it, however large the balance or however valid the destination.
fun a_withdrawal_above_the_per_tx_cap_aborts() {
    let mut scenario = test_scenario::begin(ADMIN);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000 * DAY);

    let admin = business_account::admin_cap_for_testing(ctx);
    let treasury = business_account::treasury_cap_for_testing(ctx);
    let mut t = treasury(ctx, &c, PER_TX * 10, 0);
    smart_treasury::withdraw(&mut t, &treasury, PAYEE, PER_TX + 1, &c, ctx);

    sui::test_utils::destroy(admin);
    sui::test_utils::destroy(treasury);
    let _ = smart_treasury::destroy_for_testing(t);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 705, location = splash_custody::smart_treasury)]
/// Lowering the floor frees money for withdrawal, so it requires a pause first.
/// A quiet floor reduction between two normal withdrawals is exactly how a
/// compromised key would drain a treasury without ever tripping the meter.
fun lowering_the_floor_requires_a_pause() {
    let mut scenario = test_scenario::begin(ADMIN);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000 * DAY);

    let admin = business_account::admin_cap_for_testing(ctx);
    let treasury = business_account::treasury_cap_for_testing(ctx);
    let mut t = treasury(ctx, &c, 5_000, 1_000);
    smart_treasury::set_operating_floor(&admin, &mut t, 0);

    sui::test_utils::destroy(admin);
    sui::test_utils::destroy(treasury);
    let _ = smart_treasury::destroy_for_testing(t);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
/// Raising the floor is tightening, so it is instant — reducing exposure must
/// never wait.
fun raising_the_floor_is_instant() {
    let mut scenario = test_scenario::begin(ADMIN);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000 * DAY);

    let admin = business_account::admin_cap_for_testing(ctx);
    let treasury = business_account::treasury_cap_for_testing(ctx);
    let mut t = treasury(ctx, &c, 5_000, 1_000);
    smart_treasury::set_operating_floor(&admin, &mut t, 2_000);
    assert_eq!(smart_treasury::operating_floor(&t), 2_000);

    sui::test_utils::destroy(admin);
    sui::test_utils::destroy(treasury);
    let _ = smart_treasury::destroy_for_testing(t);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
/// A withdrawal that respects every bound succeeds — the controls must not be
/// so tight that the treasury is unusable.
fun a_compliant_withdrawal_succeeds() {
    let mut scenario = test_scenario::begin(ADMIN);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000 * DAY);

    let admin = business_account::admin_cap_for_testing(ctx);
    let treasury = business_account::treasury_cap_for_testing(ctx);
    let mut t = treasury(ctx, &c, 5_000, 1_000);
    smart_treasury::withdraw(&mut t, &treasury, PAYEE, 1_000, &c, ctx);
    assert_eq!(smart_treasury::balance(&t), 4_000);

    sui::test_utils::destroy(admin);
    sui::test_utils::destroy(treasury);
    let _ = smart_treasury::destroy_for_testing(t);
    c.destroy_for_testing();
    scenario.end();
}
