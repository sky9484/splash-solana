export type Stablecoin = 'USDC' | 'USDT';

export interface RoutingParams {
  kycTier: number;
  usdcSpreadBps: number;
  usdtSpreadBps: number;
  usdcAvailableMicro: number;
  usdtAvailableMicro: number;
  transferAmountMicro: number;
  usdtBufferAgeMs: number;
}

export function selectStablecoin(p: RoutingParams): Stablecoin {
  const spreadDiff = p.usdcSpreadBps - p.usdtSpreadBps;
  const sweepTriggerMs = 27 * 60 * 1000;

  if (p.usdtBufferAgeMs > sweepTriggerMs) return 'USDC';

  if (p.usdcAvailableMicro < p.transferAmountMicro) {
    if (p.usdtAvailableMicro >= p.transferAmountMicro) return 'USDT';
    throw new Error('INSUFFICIENT_LIQUIDITY_BOTH_STABLECOINS');
  }

  if (p.kycTier >= 3 && spreadDiff > 30) return 'USDT';
  if (spreadDiff > 15) return 'USDT';

  const minFloat = Number.parseInt(process.env.MIN_USDC_FLOAT_MICRO ?? '0', 10);
  if (minFloat > 0 && p.usdcAvailableMicro < minFloat) return 'USDT';

  return 'USDC';
}
