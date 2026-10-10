/**
 * Airwallex wire and FPX deposit integration for USD-first deposits.
 * Phase 1 scaffold: Creates payment intents and confirms deposits.
 */

export interface AirwallexPaymentIntent {
  paymentId: string;
  paymentMethod: 'WIRE' | 'FPX';
  amountUsd: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export async function createAirwallexPaymentIntent(
  amountUsd: number,
  paymentMethod: 'WIRE' | 'FPX',
  transferIntentId: string
): Promise<AirwallexPaymentIntent> {
  const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY;
  if (!AIRWALLEX_API_KEY) {
    throw new Error('AIRWALLEX_API_KEY not configured');
  }

  // Phase 1 scaffold: Replace with actual Airwallex API call
  const paymentId = `aw_${Date.now()}_${transferIntentId.slice(0, 8)}`;

  return {
    paymentId,
    paymentMethod,
    amountUsd,
    status: 'pending',
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function confirmAirwallexDeposit(_paymentId: string): Promise<{ confirmed: boolean; amountUsd: number }> {
  // Phase 1 scaffold: Verify payment status with Airwallex
  return {
    confirmed: true,
    amountUsd: 0, // Extract from payment
  };
}
