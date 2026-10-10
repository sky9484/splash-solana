/**
 * Transaction limits — Splash is USD-first and not an MSB, so there is NO
 * per-user monthly MYR cap. Limits are driven by three independent dimensions:
 *
 *   1. Rail max per transaction  (Stripe/bank technical + risk ceilings)
 *   2. KYB-tier caps             (Sumsub level → higher tiers, higher limits)
 *   3. AML review thresholds     (large/unusual flagged for monitoring)
 *
 * "No cap" never means "no controls": large transfers above the AML threshold
 * are still processed but flagged for review, and KYB tier gates the ceiling.
 */

export type FundingRail = 'ach' | 'wire' | 'fpx' | 'airwallex';

export type LimitResult = {
  allowed: boolean;
  requiresReview: boolean;
  reason: string | null;
  perTxCapUsd: number;
  amlReviewThresholdUsd: number;
  kybTier: number;
};

const RAIL_MAX_USD: Record<FundingRail, number> = {
  ach: Number(process.env.RAIL_MAX_ACH_USD ?? 1_000_000),
  wire: Number(process.env.RAIL_MAX_WIRE_USD ?? 1_000_000),
  fpx: Number(process.env.RAIL_MAX_FPX_USD ?? 250_000),
  airwallex: Number(process.env.RAIL_MAX_AIRWALLEX_USD ?? 1_000_000),
};

/** KYB-tier per-transaction ceiling (USD). Higher Sumsub level → higher cap. */
export function kybTierCapUsd(tier: number): number {
  if (tier >= 3) return Number(process.env.KYB_TIER3_MAX_USD ?? 1_000_000);
  if (tier >= 2) return Number(process.env.KYB_TIER2_MAX_USD ?? 250_000);
  return Number(process.env.KYB_TIER1_MAX_USD ?? 50_000);
}

const AML_REVIEW_THRESHOLD_USD = Number(process.env.AML_REVIEW_THRESHOLD_USD ?? 10_000);

export function evaluateTransferLimits(input: {
  amountUsd: number;
  rail?: FundingRail;
  kybTier?: number;
}): LimitResult {
  const rail = input.rail ?? 'airwallex';
  const kybTier = Number.isFinite(input.kybTier)
    ? (input.kybTier as number)
    : Number(process.env.DEFAULT_KYC_TIER ?? 1);

  const railMax = RAIL_MAX_USD[rail] ?? 1_000_000;
  const tierCap = kybTierCapUsd(kybTier);
  const perTxCapUsd = Math.min(railMax, tierCap);

  if (input.amountUsd > perTxCapUsd) {
    return {
      allowed: false,
      requiresReview: false,
      reason: `Exceeds per-transaction limit of $${perTxCapUsd.toLocaleString('en-US')} (KYB tier ${kybTier} · ${rail}). Upgrade KYB tier for a higher ceiling.`,
      perTxCapUsd,
      amlReviewThresholdUsd: AML_REVIEW_THRESHOLD_USD,
      kybTier,
    };
  }

  const requiresReview = input.amountUsd >= AML_REVIEW_THRESHOLD_USD;
  return {
    allowed: true,
    requiresReview,
    reason: requiresReview
      ? 'Above the AML review threshold — flagged for monitoring (still processed).'
      : null,
    perTxCapUsd,
    amlReviewThresholdUsd: AML_REVIEW_THRESHOLD_USD,
    kybTier,
  };
}
