// lib/server/labuan-settlement.ts
// Routes settlement through the planned Splash Labuan operating perimeter.

const LABUAN_API_BASE = process.env.LABUAN_API_BASE_URL ?? 'https://settlement.splash-labuan.internal';
const LABUAN_API_KEY = process.env.LABUAN_API_KEY ?? '';
const TIMEOUT_MS = 60_000; // Labuan settlement can be slower than a spot venue

export type SettlementTier = 'labuan_spot' | 'labuan_otc' | 'bank_wire_fallback';

export interface LabuanConversionResult {
  success: boolean;
  tier: SettlementTier;
  usdAmount: string;
  usdcAmount: string;
  usdToUsdcRate: string;
  feeUsdc: string;
  txReference: string;
  labuanSettlementId: string;
  error: string | null;
}

export interface LabuanQuote {
  quoteId: string;
  usdToUsdcRate: string;
  effectiveRate: string;
  usdcAmount: string;
  feeUsdc: string;
  expiresAt: number;
}

async function fetchLabuan(path: string, body: object): Promise<Record<string, unknown>> {
  if (!LABUAN_API_KEY) return {}; // mock mode if no key configured

  const response = await fetch(`${LABUAN_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LABUAN_API_KEY}`,
      // Splash Labuan is the settlement entity of record. The Malaysian Sdn Bhd
      // is technology and marketing only and is never a party to a settlement —
      // asserting 'splash-my' on a settlement call misstates the perimeter to
      // the counterparty and to anyone reading the request logs.
      'X-Source-Entity': 'splash-labuan',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'no body');
    throw new Error(`Labuan API ${response.status}: ${text}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

/**
 * Get a quote for USD → USDC conversion via Labuan.
 */
export async function getLabuanQuote(usdAmount: number): Promise<LabuanQuote> {
  if (!LABUAN_API_KEY) return mockQuote(usdAmount);

  try {
    const data = await fetchLabuan('/v1/quote', {
      source_currency: 'USD',
      target_asset: 'USDC',
      source_amount: usdAmount.toString(),
    });

    return {
      quoteId: String(data.quote_id ?? `labuan-${Date.now()}`),
      usdToUsdcRate: String(data.usd_to_usdc_rate ?? '1.000'),
      effectiveRate: String(data.effective_rate ?? '1.000'),
      usdcAmount: String(data.usdc_amount ?? usdAmount.toFixed(6)),
      feeUsdc: String(data.fee_usdc ?? '0'),
      expiresAt: Number(data.expires_at ?? Math.floor(Date.now() / 1000) + 30),
    };
  } catch (error) {
    console.warn('[Labuan Quote] Failed, using fallback rate:', error);
    return mockQuote(usdAmount);
  }
}

/**
 * Execute USD → USDC conversion via Labuan settlement.
 *
 * Flow:
 * 1. USD deposit is confirmed by Stripe or Airwallex
 * 2. USD transferred to Splash Labuan treasury
 * 3. Splash Labuan converts USD→USDC via Circle OTC or licensed exchange
 * 4. USDC credited to operator treasury on Sui
 *
 * In Phase 0 (before Labuan license): falls back to bank wire mode (no USDC,
 * settlement recorded on Sui as Receipt only, actual disbursement via bank wire).
 */
export async function convertUsdToUsdc(usdAmount: number): Promise<LabuanConversionResult> {
  if (!LABUAN_API_KEY) return mockConversion(usdAmount);

  const OTC_THRESHOLD = Number.parseFloat(process.env.LABUAN_OTC_MIN_USD ?? '10000');

  try {
    const tier: SettlementTier = usdAmount >= OTC_THRESHOLD ? 'labuan_otc' : 'labuan_spot';

    const data = await fetchLabuan('/v1/settle', {
      source_currency: 'USD',
      source_amount: usdAmount.toString(),
      usd_amount: usdAmount.toFixed(2),
      settlement_tier: tier,
      client_ref: `splash-us-${Date.now()}`,
    });
  
    return {
      success: String(data.status) === 'confirmed' || String(data.status) === 'pending',
      tier,
      usdAmount: usdAmount.toFixed(2),
      usdcAmount: String(data.usdc_amount ?? '0'),
      usdToUsdcRate: String(data.usd_to_usdc_rate ?? '1.000'),
      feeUsdc: String(data.fee_usdc ?? '0'),
      txReference: String(data.settlement_id ?? ''),
      labuanSettlementId: String(data.settlement_id ?? ''),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Labuan error';
    return {
      success: false,
      tier: 'labuan_spot',
      usdAmount: usdAmount.toFixed(2),
      usdcAmount: '0',
      usdToUsdcRate: '0',
      feeUsdc: '0',
      txReference: '',
      labuanSettlementId: '',
      error: message,
    };
  }
}

/**
 * Get USD→USDC effective rate.
 */
export async function getUsdToUsdcRate(): Promise<number> {
  try {
    const quote = await getLabuanQuote(1000);
    const parsed = Number.parseFloat(quote.effectiveRate);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  } catch {
    return 1;
  }
}

/**
 * Convert USD (in cents) to USDC (in micro, 6 decimals).
 */
export async function usdCentsToUsdcMicro(usdCents: number): Promise<number> {
  const rate = await getUsdToUsdcRate();
  const usd = usdCents / 100;
  return Math.floor(usd * rate * 1_000_000);
}

// ── Mock functions (used when LABUAN_API_KEY is not set) ──────────────────────

function mockQuote(usdAmount: number): LabuanQuote {
  const usdToUsdc = 1.0;
  return {
    quoteId: `mock-labuan-${Date.now()}`,
    usdToUsdcRate: usdToUsdc.toString(),
    effectiveRate: usdToUsdc.toString(),
    usdcAmount: (usdAmount * usdToUsdc).toFixed(6),
    feeUsdc: '0',
    expiresAt: Math.floor(Date.now() / 1000) + 30,
  };
}

function mockConversion(usdAmount: number): LabuanConversionResult {
  const ref = `MOCK-LABUAN-${Date.now()}`;
  return {
    success: true,
    tier: 'labuan_spot',
    usdAmount: usdAmount.toFixed(2),
    usdcAmount: usdAmount.toFixed(6),
    usdToUsdcRate: '1.000',
    feeUsdc: '0',
    txReference: ref,
    labuanSettlementId: ref,
    error: null,
  };
}

// The `convertMyrToUsdc` / `getMyrToUsdcRate` / `myrSenToUsdcMicro` aliases were
// removed deliberately: Splash Labuan receives USD only, so a MYR entry point in
// the settlement module described a ringgit leg the licence perimeter does not
// have. They were aliases of the USD functions, so the names were the only thing
// that ever said "MYR" — which is precisely why they were a claims defect rather
// than a code defect. Use `convertUsdToUsdc` / `getUsdToUsdcRate` /
// `usdCentsToUsdcMicro`.
//
// The quote helpers named after a specific FX venue are gone for the same
// reason: that firm is not a party to the money path (see content/money-path.ts),
// and naming it in an identifier is still naming it.
