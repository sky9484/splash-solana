/**
 * Treasury reference data (prompt 10 §7.1, decision 13): the one place a rate or a past return may be
 * written down. Every figure carries the date it was true and the page it came from; one older than
 * 35 days is shown as out of date instead of as a number. tests/treasury-reference.test.mjs fails on a
 * figure without both, and on one past its age.
 *
 * Percentages are basis points (integers): 375 = 3.75%. Prices are US$ minor units (6 decimals) per
 * whole unit, and are TEST prices: nothing here is a live quote. Refresh all six figures on one date
 * before any external demo (§7.1).
 *
 * Checked against Ondo's own documentation on 14 Oct 2026:
 *   - https://docs.ondo.finance/addresses lists the USDY token on Solana as
 *     A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6. It doesn't list the stock tokens (it links a CSV),
 *     so their addresses stay unverified and are not used anywhere.
 *   - https://docs.ondo.finance/general-access-products/usdy/basics: "Ondo USDY LLC can only redeem USD
 *     via bank wire to non-US bank accounts." It states no holding period after a subscription, so the
 *     40-day hold (Business Module v15.1) stays UNCONFIRMED and is kept as the cautious assumption.
 */

/** A figure, the day it was true (YYYY-MM-DD), and where it came from. */
export interface Sourced<T> {
  value: T;
  asOf: string;
  sourceUrl: string;
  /** How the source words it, when that matters ("trailing", "variable · set monthly by Ondo"). */
  note?: string;
}

export const REFERENCE_MAX_AGE_DAYS = 35;
const DAY_MS = 86_400_000;

/** Whole days since a reference's date (0 on the day). */
export function ageDays(s: Pick<Sourced<unknown>, 'asOf'>, now: Date): number {
  const then = Date.parse(`${s.asOf}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return (today - then) / DAY_MS;
}

/** Fresh enough to print as a number. Older: "Rate out of date". */
export const isFresh = (s: Pick<Sourced<unknown>, 'asOf'>, now: Date) => ageDays(s, now) <= REFERENCE_MAX_AGE_DAYS;

/** 375 → "3.75%"; 2044 with a sign → "+20.44%"; −1213 → "−12.13%". Integers only. */
export function bpsText(bps: number, opts: { sign?: boolean } = {}): string {
  const neg = bps < 0;
  const abs = BigInt(Math.abs(bps));
  const text = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}%`;
  return neg ? `−${text}` : opts.sign ? `+${text}` : text;
}

export type AssetId = 'usdy' | 'spy' | 'qqq' | 'nvda' | 'googl' | 'tsla';

/** US$1.000000: prices and amounts share one unit; units are counted in millionths too. */
export const UNIT = 1_000_000n;

export interface TBillReference {
  id: 'usdy';
  name: string;
  issuer: 'Ondo';
  /** Only in "Technical details". */
  token: 'USDY';
  rate: Sourced<{ bps: number }>;
  /** Units bought straight from Ondo wait this long before they can be redeemed (UNCONFIRMED, see the header). */
  holdDays: Sourced<number> & { confirmed: false };
  /** The token on Solana, from Ondo's own address list. */
  mintSolana: Sourced<string>;
  /** TEST price of one unit. */
  testPriceMinor: bigint;
  /** TEST market depth: how far a market order moves the price (§7.1). */
  testDepthMinor: bigint;
}

export interface StockReference {
  id: Exclude<AssetId, 'usdy'>;
  /** How the screen names it: "S&P 500". */
  name: string;
  /** What the unit tracks: "SPY ETF". */
  tracks: string;
  /** Only in "Technical details". Its mint address is NOT verified against Ondo's docs and is not used. */
  token: string;
  /** Total return over the past 12 months, dividends reinvested. Past, not a forecast. */
  return12m: Sourced<{ bps: number }>;
  /** Dividends over the past 12 months; null when it pays none. Never called a "yield" (claims test). */
  dividends12m: Sourced<{ bps: number } | null>;
  testPriceMinor: bigint;
  testDepthMinor: bigint;
}

const RETURNS_SPY_QQQ = 'https://totalrealreturns.com/n/SPY,QQQ';
const RETURNS_STOCKS = 'https://totalrealreturns.com/n/NVDA,AAPL,MSFT,GOOGL,AMZN,META,TSLA';

export const TBILLS: TBillReference = {
  id: 'usdy',
  name: 'US Treasury bills',
  issuer: 'Ondo',
  token: 'USDY',
  rate: { value: { bps: 375 }, asOf: '2026-10-13', sourceUrl: 'https://ondo.finance/usdy', note: 'variable · set monthly by Ondo' },
  holdDays: { value: 40, asOf: '2026-10-14', sourceUrl: 'https://docs.ondo.finance/general-access-products/usdy/basics', note: 'not stated on Ondo’s page; Business Module v15.1', confirmed: false },
  mintSolana: { value: 'A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6', asOf: '2026-10-14', sourceUrl: 'https://docs.ondo.finance/addresses' },
  testPriceMinor: 1_124_000n,
  testDepthMinor: 25_000_000n * UNIT,
};

export const STOCKS: readonly StockReference[] = [
  {
    id: 'spy',
    name: 'S&P 500',
    tracks: 'SPY ETF',
    token: 'SPYon',
    return12m: { value: { bps: 2044 }, asOf: '2026-10-12', sourceUrl: RETURNS_SPY_QQQ },
    dividends12m: { value: { bps: 98 }, asOf: '2026-10-13', sourceUrl: 'https://stockanalysis.com/etf/compare/qqq-vs-spy/', note: 'the page shows no date: as of the day it was checked' },
    testPriceMinor: 786_180_000n,
    testDepthMinor: 2_380_000n * UNIT,
  },
  {
    id: 'qqq',
    name: 'Nasdaq-100',
    tracks: 'QQQ ETF',
    token: 'QQQon',
    return12m: { value: { bps: 2715 }, asOf: '2026-10-12', sourceUrl: RETURNS_SPY_QQQ },
    dividends12m: { value: { bps: 42 }, asOf: '2026-10-12', sourceUrl: 'https://finance.yahoo.com/quote/QQQ/' },
    testPriceMinor: 752_480_000n,
    testDepthMinor: 1_785_000n * UNIT,
  },
  {
    id: 'nvda',
    name: 'NVIDIA',
    tracks: 'NVDA',
    token: 'NVDAon',
    return12m: { value: { bps: 1935 }, asOf: '2026-10-09', sourceUrl: RETURNS_STOCKS },
    dividends12m: { value: { bps: 12 }, asOf: '2026-10-12', sourceUrl: 'https://finance.yahoo.com/quote/NVDA/key-statistics/', note: 'trailing' },
    testPriceMinor: 226_220_000n,
    testDepthMinor: 4_160_000n * UNIT,
  },
  {
    id: 'googl',
    name: 'Alphabet',
    tracks: 'GOOGL',
    token: 'GOOGLon',
    return12m: { value: { bps: 4598 }, asOf: '2026-10-09', sourceUrl: RETURNS_STOCKS },
    dividends12m: { value: { bps: 25 }, asOf: '2026-10-12', sourceUrl: 'https://stockanalysis.com/stocks/googl/' },
    testPriceMinor: 353_000_000n,
    testDepthMinor: 2_630_000n * UNIT,
  },
  {
    id: 'tsla',
    name: 'Tesla',
    tracks: 'TSLA',
    token: 'TSLAon',
    return12m: { value: { bps: -1213 }, asOf: '2026-10-09', sourceUrl: RETURNS_STOCKS },
    dividends12m: { value: null, asOf: '2026-10-09', sourceUrl: RETURNS_STOCKS, note: 'pays no dividend' },
    testPriceMinor: 373_770_000n,
    testDepthMinor: 3_125_000n * UNIT,
  },
];

export function stockRef(id: string): StockReference | null {
  return STOCKS.find((s) => s.id === id) ?? null;
}

/** Every dated figure, for the freshness test and the "Sources" list on the page. */
export function allSourced(): Array<{ label: string; figure: Sourced<unknown> }> {
  return [
    { label: 'USDY rate', figure: TBILLS.rate },
    ...STOCKS.flatMap((s) => [
      { label: `${s.name}, past 12 months`, figure: s.return12m as Sourced<unknown> },
      { label: `${s.name}, dividends`, figure: s.dividends12m as Sourced<unknown> },
    ]),
  ];
}
