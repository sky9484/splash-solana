import 'server-only';

import type { StablecoinAssetSymbol } from '@/lib/funding/registry';

/**
 * Normalise incoming funds to USDC.
 *
 * The Solana build accepts USDC only (decision D-7 in the Phase 0 inventory,
 * docs/solana-build/): funding arrives as native USDC on Solana or through a CCTP
 * V2 mint. The earlier build swapped other stablecoins into USDC through
 * DEXes; that path is gone, and no swap venue on Solana is wired until the
 * funding audit (prompt at f604453) says which one, if any. Anything other
 * than USDC is refused with a plain reason, never converted.
 */
export async function normalizeToUsdc(asset: StablecoinAssetSymbol, amountInMicro: number) {
  if (asset === 'USDC') {
    return {
      success: true as const,
      amountOutMicro: amountInMicro,
      venue: 'PASSTHROUGH' as const,
      effectiveSlippageBps: 0,
    };
  }
  return {
    success: false as const,
    reason: `This build accepts USDC only. ${asset} is not converted.`,
  };
}
