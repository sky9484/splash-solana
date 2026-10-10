/**
 * Funding rails for balance top-ups.
 *
 * MARGIN RULE: funding IN is bank-rails only (ACH / wire / FPX via Airwallex /
 * Curlec). Card + Apple Pay funding is DISABLED by default — paying Stripe's
 * ~2.9% to collect funds we move for ~1.3% destroys the margin. Card funding can
 * be explicitly enabled (and is then surcharged so the cost is passed through),
 * but bank rails stay primary. Stripe still handles what it's good at — just not
 * as the funding rail for deposits.
 */

export type FundingRail = 'ach' | 'wire' | 'fpx' | 'card';

export interface StripeCheckoutSession {
  sessionId: string;
  checkoutUrl: string;
  amountUsd: number;
  surchargeUsd: number;
  status: 'pending' | 'completed' | 'failed';
}

/** Card funding is opt-in only; default OFF to protect the margin. */
export function isCardFundingEnabled(): boolean {
  return process.env.CARD_FUNDING_ENABLED === 'true';
}

/** Surcharge (bps) applied to card deposits when enabled — passes Stripe's cost through. */
export function cardFundingSurchargeBps(): number {
  const v = Number(process.env.CARD_FUNDING_SURCHARGE_BPS ?? 290);
  return Number.isFinite(v) && v >= 0 ? v : 290;
}

/** Rails surfaced to the deposit UI / settings. Bank rails primary, card gated. */
export function getFundingRails() {
  return {
    primary: ['ach', 'wire', 'fpx'] as FundingRail[],
    card: {
      enabled: isCardFundingEnabled(),
      surchargeBps: cardFundingSurchargeBps(),
      note: isCardFundingEnabled()
        ? 'Card deposits are surcharged to cover processor fees. Bank rails are cheaper.'
        : 'Card / Apple Pay funding is disabled. Fund via ACH, wire, or FPX.',
    },
  };
}

export async function createStripeCheckoutSession(
  amountUsd: number,
  transferIntentId: string,
): Promise<StripeCheckoutSession> {
  if (!isCardFundingEnabled()) {
    throw new Error('Card funding is disabled — fund your balance via bank rails (ACH, wire, or FPX).');
  }
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }

  // Pass the processor cost through as a surcharge so card funding never erodes margin.
  const surchargeUsd = Math.round((amountUsd * cardFundingSurchargeBps()) / 10_000 * 100) / 100;

  // Phase 1 scaffold — replace with a real Stripe Checkout session create.
  const sessionId = `cs_${Date.now()}_${transferIntentId.slice(0, 8)}`;
  const checkoutUrl = `https://checkout.stripe.com/pay/${sessionId}`;

  return { sessionId, checkoutUrl, amountUsd, surchargeUsd, status: 'pending' };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function confirmStripeDeposit(_sessionId: string): Promise<{ confirmed: boolean; amountUsd: number }> {
  // Phase 1 scaffold: verify session status with Stripe.
  return { confirmed: true, amountUsd: 0 };
}
