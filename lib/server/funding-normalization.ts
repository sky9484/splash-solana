import 'server-only';

import {
  selectDeepestSafeRoute,
  type DexRouteQuote,
} from '@/lib/funding/normalization-policy';
import type { StablecoinAssetSymbol } from '@/lib/funding/registry';
import { readComplianceControls } from '@/lib/server/sui-settlement';

type ConfiguredQuote = {
  venue: DexRouteQuote['venue'];
  rate: number;
  depthUsd: number;
};

function configuredQuotes(asset: StablecoinAssetSymbol, amountInMicro: number): DexRouteQuote[] {
  if (process.env.FUNDING_DEX_QUOTES_JSON) {
    const parsed = JSON.parse(process.env.FUNDING_DEX_QUOTES_JSON) as Partial<Record<StablecoinAssetSymbol, ConfiguredQuote[]>>;
    return (parsed[asset] ?? []).map((quote) => ({
      venue: quote.venue,
      amountInMicro,
      amountOutMicro: Math.floor(amountInMicro * quote.rate),
      depthMicro: Math.floor(quote.depthUsd * 1_000_000),
    }));
  }
  if (process.env.NODE_ENV !== 'production' || process.env.USE_MOCK_APIS === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    return [
      { venue: 'CETUS', amountInMicro, amountOutMicro: Math.floor(amountInMicro * 0.9992), depthMicro: 2_500_000_000_000 },
      { venue: 'AFTERMATH', amountInMicro, amountOutMicro: Math.floor(amountInMicro * 0.9995), depthMicro: 4_000_000_000_000 },
      { venue: 'BLUEFIN', amountInMicro, amountOutMicro: Math.floor(amountInMicro * 0.9988), depthMicro: 1_700_000_000_000 },
    ];
  }
  return [];
}

export async function normalizeToUsdc(asset: StablecoinAssetSymbol, amountInMicro: number) {
  if (asset === 'USDC') {
    return {
      success: true as const,
      amountOutMicro: amountInMicro,
      venue: 'PASSTHROUGH' as const,
      effectiveSlippageBps: 0,
    };
  }

  const controls = await readComplianceControls();
  const route = selectDeepestSafeRoute(configuredQuotes(asset, amountInMicro), {
    maxSlippageBps: controls.maxSlippageBps,
    minDepthMicro: controls.minDepthBaseUnits,
  });
  if (!route) {
    return {
      success: false as const,
      reason: 'No DEX route satisfies the configured depth and slippage guard',
    };
  }
  return {
    success: true as const,
    amountOutMicro: route.amountOutMicro,
    venue: route.venue,
    effectiveSlippageBps: route.effectiveSlippageBps,
  };
}
