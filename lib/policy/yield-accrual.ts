/**
 * Yield derivation. The one rule this module exists to enforce:
 *
 *     Positions create yield. The ledger RECORDS it. The ledger never CREATES it.
 *
 * `accrueDailyYield` used to compute `netApyPct / 100 / 365` and write the
 * result into balances — a configured constant manufacturing money on the
 * cron's schedule, whether or not the instrument earned anything and whether or
 * not the position existed. It also fetched the redemption price and then
 * ignored it: the number appeared in the snapshot while the arithmetic came
 * from the APY.
 *
 * USDY accrues through price, so the day's yield IS the price delta on units
 * held. Kept pure and separate from the ledger so it can be tested without a
 * store, and so the absence of an APY term is visible at a glance.
 *
 * All arithmetic in integer micro-units. No float in the accounting path.
 */

const MICROS = BigInt(1_000_000);

export type AccrualInput = {
  /** Position principal, micro-USD. */
  principalMicro: bigint;
  /** Current NAV, micro-USD per unit. */
  priceMicros: bigint;
  /** NAV at the previous recorded accrual. `null` = no baseline yet. */
  previousPriceMicros: bigint | null;
};

export type AccrualResult =
  | { accrued: false; reason: 'no-baseline' | 'no-position'; yieldMicro: bigint }
  | { accrued: true; yieldMicro: bigint; unitsMicro: bigint; deltaMicros: bigint };

/**
 * Yield for one position over one price move.
 *
 * Returns a NEGATIVE figure when the price fell. That is deliberate: a
 * redemption price that moved down is a real loss on the position, and clamping
 * it at zero would report a floor the instrument does not have.
 */
export function deriveYieldMicros(input: AccrualInput): AccrualResult {
  const { principalMicro, priceMicros, previousPriceMicros } = input;

  if (priceMicros <= BigInt(0)) {
    // Callers must fail closed on UNAVAILABLE before reaching here; this is a
    // belt-and-braces guard so a bad price can never divide.
    return { accrued: false, reason: 'no-baseline', yieldMicro: BigInt(0) };
  }
  // No baseline means no delta. The first observation establishes one and
  // records nothing — there is no yield from a price we never saw.
  if (previousPriceMicros === null) {
    return { accrued: false, reason: 'no-baseline', yieldMicro: BigInt(0) };
  }
  if (principalMicro <= BigInt(0)) {
    return { accrued: false, reason: 'no-position', yieldMicro: BigInt(0) };
  }

  // units ≈ principal / price, carried in micro-units.
  const unitsMicro = (principalMicro * MICROS) / priceMicros;
  const deltaMicros = priceMicros - previousPriceMicros;
  const yieldMicro = (unitsMicro * deltaMicros) / MICROS;

  return { accrued: true, yieldMicro, unitsMicro, deltaMicros };
}

/** Spread is taken on gains only — never charged against a loss. */
export function spreadOnGain(yieldMicro: bigint, spreadBps = 50): bigint {
  if (yieldMicro <= BigInt(0)) return BigInt(0);
  return (yieldMicro * BigInt(spreadBps)) / BigInt(10_000);
}
