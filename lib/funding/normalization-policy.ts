export type DexRouteQuote = {
  venue: 'CETUS' | 'AFTERMATH' | 'BLUEFIN';
  amountInMicro: number;
  amountOutMicro: number;
  depthMicro: number;
};

export type NormalizationGuard = {
  maxSlippageBps: number;
  minDepthMicro: number;
};

export type EvaluatedDexRoute = DexRouteQuote & {
  effectiveSlippageBps: number;
};

export function evaluateDexRoute(quote: DexRouteQuote, guard: NormalizationGuard): EvaluatedDexRoute | null {
  if (quote.amountInMicro <= 0 || quote.amountOutMicro <= 0 || quote.depthMicro < guard.minDepthMicro) return null;
  const effectiveSlippageBps = Math.max(
    0,
    Math.round(((quote.amountInMicro - quote.amountOutMicro) / quote.amountInMicro) * 10_000),
  );
  if (effectiveSlippageBps > guard.maxSlippageBps) return null;
  return { ...quote, effectiveSlippageBps };
}

export function selectDeepestSafeRoute(quotes: DexRouteQuote[], guard: NormalizationGuard) {
  return quotes
    .map((quote) => evaluateDexRoute(quote, guard))
    .filter((quote): quote is EvaluatedDexRoute => quote !== null)
    .sort((a, b) => b.depthMicro - a.depthMicro)[0] ?? null;
}
