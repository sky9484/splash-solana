/**
 * The worked example on /working-capital (prompt 12 Phase 4): invoice INV-4471, US$100,000 on net 90,
 * which the buyer offers to pay today at a 1.2% discount. Illustrative only, never a quote: dynamic
 * discounting is a coming capability, subject to licensing. Integer cents through lib/money.ts, and the
 * page shows exactly these strings.
 */
import { applyBps, divRound, formatMinor, parseMinor, USD_DECIMALS } from '@/lib/money';

const FACE_MINOR = parseMinor('100000', USD_DECIMALS);
const DISCOUNT_BPS = 120n;
const TENOR_DAYS = 90n;
const DAYS_A_YEAR = 365n;

/** "US$98,800", or "US$98,800.50" when there are cents. */
export function usdText(minor: bigint): string {
  const [whole, cents] = formatMinor(minor, USD_DECIMALS).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return cents === '00' ? `US$${grouped}` : `US$${grouped}.${cents}`;
}

/** Basis points as a percentage with no trailing zeros: 120 → "1.2%", 125 → "1.25%". */
export function bpsText(bps: bigint): string {
  const whole = bps / 100n;
  const frac = (bps % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}%` : `${whole}%`;
}

const discountMinor = applyBps(FACE_MINOR, DISCOUNT_BPS, 'half-up');
const earlyMinor = FACE_MINOR - discountMinor;
/**
 * What the buyer saves, a year: the discount over the cash it pays early, over the days it pays early,
 * in tenths of a percent (half-up). A saving for the buyer, not a return to Splash or the supplier.
 */
const savedTenthsPct = divRound(discountMinor * DAYS_A_YEAR * 1000n, earlyMinor * TENOR_DAYS, 'half-up');

export const WC_ILLUSTRATION = {
  invoice: 'INV-4471',
  tenorDays: TENOR_DAYS.toString(),
  face: usdText(FACE_MINOR),
  early: usdText(earlyMinor),
  discount: usdText(discountMinor),
  discountRate: bpsText(DISCOUNT_BPS),
  buyerSavesAYear: `${savedTenthsPct / 10n}.${savedTenthsPct % 10n}%`,
  minor: { face: FACE_MINOR, early: earlyMinor, discount: discountMinor },
} as const;
