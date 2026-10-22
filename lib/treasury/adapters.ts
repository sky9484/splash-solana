/**
 * Investment adapters (prompt 10 §7.4). Each one quotes an order and says how it would settle; in
 * test mode the company approves an off-chain order on its device and the simulator plays the other
 * side. Two mocks:
 *
 *   usdy-sim         T-bills (USDY, issued by Ondo). Subscribe on the market (no hold, the price moves
 *                    with the order) or straight from Ondo (units held 40 days, UNCONFIRMED: see
 *                    reference.ts). Redeem on the market (US dollars back into the Payments account) or
 *                    with Ondo (US dollars by bank wire to the company's bank account, outside Splash:
 *                    never into the Payments account).
 *   ondo-stocks-sim  US stocks and ETFs via Ondo, bought and sold on the market. Ondo's own mint and
 *                    redeem needs the company onboarded with Ondo; until then an order is capped at what
 *                    the market allows (the 0.30% price-moved limit) and the sheet says why.
 *
 * Integers only. Units are counted in millionths (UNIT); prices are US$ minor units per whole unit.
 */
import { stockRef, TBILLS, UNIT, type AssetId } from './reference.ts';

export type OrderKind = 'subscribe' | 'redeem' | 'buy' | 'sell';
export type OrderPath = 'market' | 'ondo';

/** A market order stops if it would move the price more than this (basis points). */
export const PRICE_MOVED_LIMIT_BPS = 30n;

export interface OrderQuote {
  asset: AssetId;
  kind: OrderKind;
  path: OrderPath;
  /** US$ minor units: what is paid in (subscribe, buy) or paid out (redeem, sell). */
  amountMinor: bigint;
  /** Units bought or sold, in millionths of a unit. */
  unitsMicro: bigint;
  /** TEST price of one unit. */
  priceMinor: bigint;
  /** How far the order moves the market price, in basis points; null off the market. */
  priceMovedBps: bigint | null;
  withinLimit: boolean;
  /** Days the units wait before they can be redeemed (straight from Ondo), else 0. */
  holdDays: number;
  /** Where the result lands. */
  landsIn: 'investments' | 'payments' | 'bank_wire';
  /** The most this path takes in one order today (the market's depth at the limit). */
  maxMinor: bigint;
}

export interface InvestmentAdapter {
  readonly name: 'usdy-sim' | 'ondo-stocks-sim';
  quote(req: { asset: AssetId; kind: OrderKind; path: OrderPath; amountMinor: bigint }): OrderQuote;
}

const ceilDiv = (n: bigint, d: bigint) => (n <= 0n ? 0n : (n + d - 1n) / d);

/** Units an amount buys at a price (rounded down: never more than paid for). */
export const unitsFor = (amountMinor: bigint, priceMinor: bigint) => (amountMinor * UNIT) / priceMinor;
/** What units are worth at a price (rounded down). */
export const valueOf = (unitsMicro: bigint, priceMinor: bigint) => (unitsMicro * priceMinor) / UNIT;

function market(depthMinor: bigint, amountMinor: bigint) {
  const moved = ceilDiv(amountMinor * 10_000n, depthMinor);
  return { priceMovedBps: moved, withinLimit: moved <= PRICE_MOVED_LIMIT_BPS, maxMinor: (depthMinor * PRICE_MOVED_LIMIT_BPS) / 10_000n };
}

export const usdySim: InvestmentAdapter = {
  name: 'usdy-sim',
  quote({ kind, path, amountMinor }) {
    if (kind !== 'subscribe' && kind !== 'redeem') throw new Error('T-bills are subscribed and redeemed');
    const priceMinor = TBILLS.testPriceMinor;
    const base = { asset: 'usdy' as const, kind, path, amountMinor, unitsMicro: unitsFor(amountMinor, priceMinor), priceMinor };
    if (path === 'market') {
      return { ...base, ...market(TBILLS.testDepthMinor, amountMinor), holdDays: 0, landsIn: kind === 'subscribe' ? 'investments' : 'payments' };
    }
    // Straight from Ondo: no market price to move; a subscription waits out the hold, a redemption goes by wire.
    return { ...base, priceMovedBps: null, withinLimit: true, holdDays: kind === 'subscribe' ? TBILLS.holdDays.value : 0, landsIn: kind === 'subscribe' ? 'investments' : 'bank_wire', maxMinor: amountMinor };
  },
};

export const ondoStocksSim: InvestmentAdapter = {
  name: 'ondo-stocks-sim',
  quote({ asset, kind, path, amountMinor }) {
    if (kind !== 'buy' && kind !== 'sell') throw new Error('Stocks are bought and sold');
    if (path !== 'market') throw new Error('Ondo’s own mint and redeem needs the company onboarded with Ondo');
    const ref = stockRef(asset);
    if (!ref) throw new Error(`Not a stock: ${asset}`);
    return {
      asset,
      kind,
      path,
      amountMinor,
      unitsMicro: unitsFor(amountMinor, ref.testPriceMinor),
      priceMinor: ref.testPriceMinor,
      ...market(ref.testDepthMinor, amountMinor),
      holdDays: 0,
      landsIn: kind === 'buy' ? 'investments' : 'payments',
    };
  },
};

export function adapterFor(asset: AssetId): InvestmentAdapter {
  return asset === 'usdy' ? usdySim : ondoStocksSim;
}

/** The current TEST price of an asset. */
export function testPrice(asset: AssetId): bigint {
  if (asset === 'usdy') return TBILLS.testPriceMinor;
  const ref = stockRef(asset);
  if (!ref) throw new Error(`Not an asset: ${asset}`);
  return ref.testPriceMinor;
}
