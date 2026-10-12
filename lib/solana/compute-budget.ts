/**
 * Compute budget for sponsored transactions (prompt 07 §5.3): a unit limit, then a unit price, as
 * the first two top-level instructions.
 *
 * Where they go: compute budget instructions only take effect at the TOP LEVEL of a transaction.
 * Inside a Squads vault transaction they would run as a CPI and do nothing, so they lead each
 * outer transaction (proposal and execute) instead. That is the one place §5.3's "the vault
 * transaction holds ComputeBudget first" can be honoured.
 *
 * The priority fee comes from a recent-fees estimate and is capped so the fee payer never spends
 * more than `maxPriorityFeeLamports` on priority in one transaction. The cap uses the same formula
 * as `validateSponsoredTransaction` (lamports = ceil(price × limit / 10^6)), so a transaction built
 * here always passes the sponsor check.
 */
import { ComputeBudgetProgram, type TransactionInstruction } from '@solana/web3.js';

/** Kora's max_priority_fee_lamports (lib/solana/kora.toml) and defaultSponsorPolicy. */
export const MAX_PRIORITY_FEE_LAMPORTS = 100_000n;

/** Unit limits when no simulation is available (the execute cannot be simulated before its proposal exists). */
export const DEFAULT_UNIT_LIMITS = {
  proposal: 120_000,
  execute: 220_000,
  /** A CCTP depositForBurn through Squads costs more. */
  executeCctp: 420_000,
} as const;

/** Never ask for more than a transaction may use. */
export const MAX_UNIT_LIMIT = 1_400_000;
/** Margin over a simulated figure, in percent. */
export const SIMULATION_MARGIN_PCT = 15;

/** A unit limit from a simulation: units consumed plus the margin, rounded up to a 1,000. */
export function unitLimitFromSimulation(unitsConsumed: number, fallback: number): number {
  if (!Number.isFinite(unitsConsumed) || unitsConsumed <= 0) return fallback;
  const withMargin = Math.ceil((unitsConsumed * (100 + SIMULATION_MARGIN_PCT)) / 100);
  return Math.min(MAX_UNIT_LIMIT, Math.ceil(withMargin / 1_000) * 1_000);
}

/**
 * The unit price (micro-lamports per unit) to pay: the estimate, capped so the total priority fee
 * stays within `maxPriorityFeeLamports`. Integer arithmetic throughout.
 */
export function cappedMicroLamports(unitLimit: number, estimateMicroLamports: number | bigint, maxPriorityFeeLamports: bigint = MAX_PRIORITY_FEE_LAMPORTS): bigint {
  if (!Number.isInteger(unitLimit) || unitLimit <= 0) throw new Error('unit limit must be a positive integer');
  const estimate = typeof estimateMicroLamports === 'bigint' ? estimateMicroLamports : BigInt(Math.max(0, Math.round(Number.isFinite(estimateMicroLamports) ? estimateMicroLamports : 0)));
  const cap = (maxPriorityFeeLamports * 1_000_000n) / BigInt(unitLimit);
  return estimate < 0n ? 0n : estimate > cap ? cap : estimate;
}

/** Priority fee in lamports the fee payer would spend, as the sponsor check computes it. */
export function priorityFeeLamports(unitLimit: number, microLamports: bigint): bigint {
  return (microLamports * BigInt(unitLimit) + 999_999n) / 1_000_000n;
}

/** [setComputeUnitLimit, setComputeUnitPrice], in that order. */
export function computeBudgetInstructions(p: { unitLimit: number; microLamports: bigint }): TransactionInstruction[] {
  if (!Number.isInteger(p.unitLimit) || p.unitLimit <= 0 || p.unitLimit > MAX_UNIT_LIMIT) throw new Error(`unit limit must be 1..${MAX_UNIT_LIMIT}`);
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: p.unitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p.microLamports }),
  ];
}

/**
 * A recent-fees estimate from `getRecentPrioritizationFees` samples: the 75th percentile of the
 * non-zero fees (micro-lamports per unit), or 0 when the network shows no contention.
 */
export function estimateFromRecentFees(samples: ReadonlyArray<{ prioritizationFee: number }>): number {
  const fees = samples.map((s) => s.prioritizationFee).filter((f) => Number.isFinite(f) && f > 0).sort((a, b) => a - b);
  if (fees.length === 0) return 0;
  return fees[Math.min(fees.length - 1, Math.floor(fees.length * 0.75))]!;
}
