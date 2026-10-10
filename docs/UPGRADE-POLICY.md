# Splash Upgrade Policy

Status: policy baseline for Phase A. Implementation is pending until the
multisig custody and package publish PR lands.

## Upgrade Authority

UpgradeCap custody belongs to the same 2-of-3 Sui multisig used for governance:
Sky, Sebastian, and a cold-backup holder. No hot operator service should hold or
delegate UpgradeCap authority.

## Upgrade Gate

Before any Move package upgrade:

1. Scope the changed modules and update `SECURITY.md` if a finding changes
   status.
2. Run `sui move build` and `sui move test` with a CLI compatible with the
   pinned framework revision.
3. Confirm every new abort code is registered in
   `lib/server/sui-settlement.ts::ABORT_CODES`.
4. Confirm `compliance_config.assert_active` is wired into any new money-moving
   entry function.
5. Confirm scaffold modules are not presented as production-grade unless their
   Phase A rewrites and tests have shipped.
6. Record the testnet package digest, upgraded package ID, UpgradeCap object ID,
   multisig transaction digest, and rollback decision.

## Rollback And Pause

If an upgrade changes settlement, treasury, receivable, or evidence behavior,
operators must prepare an emergency pause transaction before executing the
upgrade. If post-upgrade verification fails, pause first, then assess rollback or
follow-up upgrade. Off-chain routes must refuse submit while the on-chain
compliance config is paused.

## Out Of Scope Until Approved

- Mainnet publication of scaffold modules called out as open in `SECURITY.md`.
- Enabling third-party receivable financing.
- Any upgrade that introduces customer-fund custody claims not reflected in the
  compliance and licensing docs.
