#[test_only]
module splash_evidence::allowlist_tests;

use splash_evidence::allowlist::{Self, Allowlist};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};

// The first approver signs the create; the others are added by a member.
const FIRST: address = @0xA11CE;
const SECOND: address = @0xB0B;
const AUDITOR: address = @0xA0D17;
const STRANGER: address = @0x5714;
/// Splash's evidence sponsor. It pays gas for members' transactions; it is
/// never a member, so as a sender it can change nothing.
const SPONSOR: address = @0x5B0;

const NOW: u64 = 1_760_000_000_000;
const DAY: u64 = 24 * 60 * 60 * 1000;

fun identity(list: &Allowlist, nonce: vector<u8>): vector<u8> {
    let mut id = allowlist::namespace(list);
    id.append(nonce);
    id
}

fun clock_at(scenario: &mut Scenario, ms: u64): Clock {
    let mut clock = clock::create_for_testing(scenario.ctx());
    clock.set_for_testing(ms);
    clock
}

/// FIRST creates the list; returns the scenario positioned for the next tx.
fun start(): Scenario {
    let mut scenario = ts::begin(FIRST);
    allowlist::create_for_testing(scenario.ctx());
    scenario
}

/// FIRST adds SECOND.
fun with_two_members(): Scenario {
    let mut scenario = start();
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    allowlist::add_for_testing(&mut list, SECOND, scenario.ctx());
    ts::return_shared(list);
    scenario
}

/// FIRST grants AUDITOR for `days`.
fun grant_auditor(scenario: &mut Scenario, days: u64) {
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    let clock = clock_at(scenario, NOW);
    allowlist::grant_for_testing(&mut list, AUDITOR, NOW + days * DAY, &clock, scenario.ctx());
    clock.destroy_for_testing();
    ts::return_shared(list);
}

// ─── Rule 3: the creator is the first member ───────────────────────────────

#[test]
fun the_creator_is_the_only_first_member() {
    let mut scenario = start();
    scenario.next_tx(FIRST);
    let list = scenario.take_shared<Allowlist>();
    assert!(allowlist::members(&list) == &vector[FIRST]);
    assert!(allowlist::generation(&list) == 0);
    assert!(allowlist::grant_count(&list) == 0);
    assert!(!allowlist::is_member(&list, SPONSOR));
    ts::return_shared(list);
    scenario.end();
}

// ─── Rule 1: seal_approve ──────────────────────────────────────────────────

#[test]
fun members_can_read_and_strangers_cannot() {
    let mut scenario = with_two_members();
    scenario.next_tx(FIRST);
    let list = scenario.take_shared<Allowlist>();
    let id = identity(&list, b"bundle-1");
    assert!(allowlist::can_read(&list, FIRST, id, NOW));
    assert!(allowlist::can_read(&list, SECOND, id, NOW));
    assert!(!allowlist::can_read(&list, STRANGER, id, NOW));
    assert!(!allowlist::can_read(&list, SPONSOR, id, NOW));
    ts::return_shared(list);
    scenario.end();
}

#[test]
fun seal_approve_passes_for_a_member() {
    let mut scenario = with_two_members();
    scenario.next_tx(SECOND);
    let list = scenario.take_shared<Allowlist>();
    let clock = clock_at(&mut scenario, NOW);
    allowlist::seal_approve_for_testing(identity(&list, b"bundle-1"), &list, &clock, scenario.ctx());
    clock.destroy_for_testing();
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::ENoAccess)]
fun seal_approve_aborts_for_the_sponsor() {
    let mut scenario = start();
    scenario.next_tx(SPONSOR);
    let list = scenario.take_shared<Allowlist>();
    let clock = clock_at(&mut scenario, NOW);
    allowlist::seal_approve_for_testing(identity(&list, b"bundle-1"), &list, &clock, scenario.ctx());
    clock.destroy_for_testing();
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::ENoAccess)]
fun seal_approve_aborts_for_an_identity_from_another_list() {
    let mut scenario = start();
    // A second org's list, created by someone else.
    scenario.next_tx(STRANGER);
    allowlist::create_for_testing(scenario.ctx());
    scenario.next_tx(FIRST);
    let ids = ts::ids_for_sender<Allowlist>(&scenario);
    assert!(ids.is_empty()); // shared objects are not owned by anyone
    let first_list = scenario.take_shared<Allowlist>();
    let other_list = scenario.take_shared<Allowlist>();
    // The member of one list presents an identity under the other list's namespace.
    let (mine, theirs) = if (allowlist::is_member(&first_list, FIRST)) (first_list, other_list) else (other_list, first_list);
    let foreign = identity(&theirs, b"bundle-x");
    let clock = clock_at(&mut scenario, NOW);
    allowlist::seal_approve_for_testing(foreign, &mine, &clock, scenario.ctx());
    clock.destroy_for_testing();
    ts::return_shared(mine);
    ts::return_shared(theirs);
    scenario.end();
}

#[test]
fun the_namespace_prefix_is_required() {
    let mut scenario = start();
    scenario.next_tx(FIRST);
    let list = scenario.take_shared<Allowlist>();
    assert!(!allowlist::can_read(&list, FIRST, b"not-a-namespace", NOW));
    assert!(!allowlist::can_read(&list, FIRST, vector[], NOW));
    // The bare namespace (no nonce) is under it.
    assert!(allowlist::can_read(&list, FIRST, allowlist::namespace(&list), NOW));
    ts::return_shared(list);
    scenario.end();
}

// ─── Rule 2: only a member can change the list ─────────────────────────────

#[test]
#[expected_failure(abort_code = allowlist::ENotAMember)]
fun the_sponsor_cannot_add_itself() {
    let mut scenario = start();
    scenario.next_tx(SPONSOR);
    let mut list = scenario.take_shared<Allowlist>();
    allowlist::add_for_testing(&mut list, SPONSOR, scenario.ctx());
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::ENotAMember)]
fun a_stranger_cannot_remove_a_member() {
    let mut scenario = with_two_members();
    scenario.next_tx(STRANGER);
    let mut list = scenario.take_shared<Allowlist>();
    allowlist::remove_for_testing(&mut list, SECOND, scenario.ctx());
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::ENotAMember)]
fun the_sponsor_cannot_grant_itself_access() {
    let mut scenario = start();
    scenario.next_tx(SPONSOR);
    let mut list = scenario.take_shared<Allowlist>();
    let clock = clock_at(&mut scenario, NOW);
    allowlist::grant_for_testing(&mut list, SPONSOR, NOW + DAY, &clock, scenario.ctx());
    clock.destroy_for_testing();
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::ENotAMember)]
fun an_auditor_cannot_grant_others() {
    let mut scenario = start();
    grant_auditor(&mut scenario, 30);
    scenario.next_tx(AUDITOR);
    let mut list = scenario.take_shared<Allowlist>();
    let clock = clock_at(&mut scenario, NOW);
    allowlist::grant_for_testing(&mut list, STRANGER, NOW + DAY, &clock, scenario.ctx());
    clock.destroy_for_testing();
    ts::return_shared(list);
    scenario.end();
}

#[test]
fun a_second_member_has_the_same_powers() {
    let mut scenario = with_two_members();
    scenario.next_tx(SECOND);
    let mut list = scenario.take_shared<Allowlist>();
    allowlist::remove_for_testing(&mut list, FIRST, scenario.ctx());
    assert!(allowlist::members(&list) == &vector[SECOND]);
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::ELastMember)]
fun the_last_member_cannot_be_removed() {
    let mut scenario = start();
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    allowlist::remove_for_testing(&mut list, FIRST, scenario.ctx());
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::EDuplicate)]
fun a_member_cannot_be_added_twice() {
    let mut scenario = with_two_members();
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    allowlist::add_for_testing(&mut list, SECOND, scenario.ctx());
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::EInvalidAddress)]
fun the_zero_address_is_refused() {
    let mut scenario = start();
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    allowlist::add_for_testing(&mut list, @0x0, scenario.ctx());
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::ETooMany)]
fun a_list_holds_at_most_sixteen_members() {
    let mut scenario = start();
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    let mut i: u64 = 1;
    while (i <= 16) {
        allowlist::add_for_testing(&mut list, sui::address::from_u256((0x1000 + i) as u256), scenario.ctx());
        i = i + 1;
    };
    ts::return_shared(list);
    scenario.end();
}

// ─── Auditor grants ────────────────────────────────────────────────────────

#[test]
fun an_auditor_reads_until_the_grant_expires() {
    let mut scenario = start();
    grant_auditor(&mut scenario, 30);
    scenario.next_tx(FIRST);
    let list = scenario.take_shared<Allowlist>();
    let id = identity(&list, b"bundle-1");
    assert!(allowlist::can_read(&list, AUDITOR, id, NOW));
    assert!(allowlist::can_read(&list, AUDITOR, id, NOW + 30 * DAY - 1));
    assert!(!allowlist::can_read(&list, AUDITOR, id, NOW + 30 * DAY));
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::EGrantTooLong)]
fun a_grant_is_time_boxed() {
    let mut scenario = start();
    grant_auditor(&mut scenario, 91);
    scenario.end();
}

#[test]
fun a_grant_of_exactly_ninety_days_is_allowed() {
    let mut scenario = start();
    grant_auditor(&mut scenario, 90);
    scenario.next_tx(FIRST);
    let list = scenario.take_shared<Allowlist>();
    assert!(allowlist::grant_count(&list) == 1);
    assert!(allowlist::max_grant_ms() == 90 * DAY);
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::EExpiryInThePast)]
fun a_grant_in_the_past_is_refused() {
    let mut scenario = start();
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    let clock = clock_at(&mut scenario, NOW);
    allowlist::grant_for_testing(&mut list, AUDITOR, NOW, &clock, scenario.ctx());
    clock.destroy_for_testing();
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::EMemberCannotBeGranted)]
fun a_member_is_not_given_a_grant() {
    let mut scenario = with_two_members();
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    let clock = clock_at(&mut scenario, NOW);
    allowlist::grant_for_testing(&mut list, SECOND, NOW + DAY, &clock, scenario.ctx());
    clock.destroy_for_testing();
    ts::return_shared(list);
    scenario.end();
}

#[test]
fun re_granting_replaces_the_expiry() {
    let mut scenario = start();
    grant_auditor(&mut scenario, 30);
    grant_auditor(&mut scenario, 5);
    scenario.next_tx(FIRST);
    let list = scenario.take_shared<Allowlist>();
    assert!(allowlist::grant_count(&list) == 1);
    assert!(!allowlist::can_read(&list, AUDITOR, identity(&list, b"b"), NOW + 6 * DAY));
    ts::return_shared(list);
    scenario.end();
}

#[test]
fun a_member_revokes_one_grant_early() {
    let mut scenario = start();
    grant_auditor(&mut scenario, 30);
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    allowlist::revoke_for_testing(&mut list, AUDITOR, scenario.ctx());
    assert!(!allowlist::can_read(&list, AUDITOR, identity(&list, b"b"), NOW));
    ts::return_shared(list);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = allowlist::ENoSuchGrant)]
fun revoking_a_grant_that_does_not_exist_aborts() {
    let mut scenario = start();
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    allowlist::revoke_for_testing(&mut list, AUDITOR, scenario.ctx());
    ts::return_shared(list);
    scenario.end();
}

// ─── Rule 4: any authority change revokes every grant ──────────────────────

#[test]
fun adding_a_member_revokes_every_grant() {
    let mut scenario = start();
    grant_auditor(&mut scenario, 30);
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    assert!(allowlist::grant_count(&list) == 1);
    allowlist::add_for_testing(&mut list, SECOND, scenario.ctx());
    assert!(allowlist::grant_count(&list) == 0);
    assert!(!allowlist::can_read(&list, AUDITOR, identity(&list, b"b"), NOW));
    ts::return_shared(list);
    scenario.end();
}

#[test]
fun removing_a_member_revokes_every_grant() {
    let mut scenario = with_two_members();
    grant_auditor(&mut scenario, 30);
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    allowlist::remove_for_testing(&mut list, SECOND, scenario.ctx());
    assert!(allowlist::grant_count(&list) == 0);
    assert!(!allowlist::can_read(&list, AUDITOR, identity(&list, b"b"), NOW));
    assert!(!allowlist::can_read(&list, SECOND, identity(&list, b"b"), NOW));
    ts::return_shared(list);
    scenario.end();
}

#[test]
fun every_change_bumps_the_generation() {
    let mut scenario = with_two_members(); // 1
    grant_auditor(&mut scenario, 10); // 2
    scenario.next_tx(FIRST);
    let mut list = scenario.take_shared<Allowlist>();
    allowlist::revoke_for_testing(&mut list, AUDITOR, scenario.ctx()); // 3
    allowlist::remove_for_testing(&mut list, SECOND, scenario.ctx()); // 4
    assert!(allowlist::generation(&list) == 4);
    ts::return_shared(list);
    scenario.end();
}
