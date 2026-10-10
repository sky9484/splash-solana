/// GuardianCap — the stop button, and nothing else.
///
/// Audit A-11, and the Step Finance shape specifically: an attacker who owns the
/// production server moves money through legitimate admin controls, and the only
/// thing that helps is somebody hitting stop fast. A 2-of-3 cold multisig needs
/// two humans awake and coordinated; this needs one signature from one machine.
///
/// The capability is deliberately SUBTRACTIVE. It can pause a meter. It cannot
/// unpause one, cannot raise a limit, cannot name a recipient, cannot move a
/// coin. A stolen `GuardianCap` is therefore a denial of service and never a
/// theft — which is what makes it safe to leave on an always-on watcher host, or
/// in the hands of an automated monitor that trips on an anomalous
/// `MeterCharged`. A guardian that must be woken by a human is a guardian that
/// is asleep during the incident.
///
/// Unpausing is `AdminCap` work in the consuming package, by construction: the
/// key that can restart money movement should be the cold one.
module splash_meter::guardian;

use sui::event;

/// Guardian may only pause a meter it was minted for.
const E_WRONG_METER: u64 = 920;
const E_INVALID_HOLDER: u64 = 921;

/// `key` ONLY — no `store`, for the same reason `AttestationCap` has none: it
/// cannot be `public_transfer`red out of this module, parked in a Kiosk, or
/// wrapped and sold. Custody changes go through mint/destroy and leave an event.
public struct GuardianCap has key {
    id: UID,
    /// Which meter this guardian watches. A guardian for the payout meter cannot
    /// pause the fee meter — blast radius of a stolen cap stays scoped.
    meter_id: ID,
}

public struct GuardianMinted has copy, drop {
    guardian_cap_id: address,
    meter_id: ID,
    holder: address,
}

public struct GuardianDestroyed has copy, drop {
    guardian_cap_id: address,
    meter_id: ID,
}

/// `public(package)` — minting is reachable only through
/// `spend_meter::mint_guardian`, which requires a `&SpendMeter`.
///
/// The gate cannot live in this module: splash_meter has no dependencies and so
/// no notion of `AdminCap`, and this module cannot import `spend_meter` because
/// `spend_meter` already imports it (Move forbids the cycle). Putting the
/// wrapper on the other side gives the same property — a `&SpendMeter` is only
/// obtainable by borrowing it out of the custodial struct that holds it, and
/// Move makes struct fields private to their defining module, so only
/// `settlement.move` can produce that argument, behind `AdminCap`.
public(package) fun mint(meter_id: ID, holder: address, ctx: &mut TxContext): GuardianCap {
    assert!(holder != @0x0, E_INVALID_HOLDER);
    let cap = GuardianCap { id: object::new(ctx), meter_id };
    event::emit(GuardianMinted {
        guardian_cap_id: object::uid_to_address(&cap.id),
        meter_id,
        holder,
    });
    cap
}

/// Mint and hand over in one step. The `holder` never types an address and the
/// cap cannot be mis-sent, because the event records where it went.
public(package) fun mint_and_transfer(meter_id: ID, holder: address, ctx: &mut TxContext) {
    transfer::transfer(mint(meter_id, holder, ctx), holder);
}

/// Burn a guardian — rotation, or retiring a watcher host. Callable by the
/// HOLDER, since the cap has no `store` and the multisig cannot reach an owned
/// object it does not own.
public fun destroy(cap: GuardianCap) {
    let GuardianCap { id, meter_id } = cap;
    event::emit(GuardianDestroyed {
        guardian_cap_id: object::uid_to_address(&id),
        meter_id,
    });
    id.delete();
}

public fun meter_id(cap: &GuardianCap): ID { cap.meter_id }

/// Asserted by `spend_meter::guardian_pause` before it trusts the cap.
public fun assert_watches(cap: &GuardianCap, meter_id: ID) {
    assert!(cap.meter_id == meter_id, E_WRONG_METER);
}

#[test_only]
public fun mint_for_testing(meter_id: ID, ctx: &mut TxContext): GuardianCap {
    GuardianCap { id: object::new(ctx), meter_id }
}
