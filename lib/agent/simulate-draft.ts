import type { SimulationResult, UnsignedProposal } from './types.ts';

/**
 * Check a desk draft before anyone is asked to approve it: the draft's own
 * balance effect, compared with the financial impact it states.
 *
 * Chain-free. The earlier build composed each draft as a Sui transaction and
 * dry-ran it; that is gone. On the Solana build a real payment is a Squads
 * vault proposal that the payment flow simulates before the device prompt
 * (prompt 07 §5.4). Until desk drafts are wired to that flow, drafts are
 * checked offline only: `mode: 'mock'`, labelled as such. Asking for live
 * simulation fails closed rather than pretending.
 */

function positiveImpactAmount(proposal: UnsignedProposal): bigint {
  return proposal.explain.financialImpact.amountOut ?? proposal.explain.financialImpact.amountIn ?? 0n;
}

const abs = (value: bigint) => (value < 0n ? -value : value);

function parseAmount(value: string): bigint | null {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** Within 5 bps of the stated amount, in integers. */
function withinTolerance(observed: bigint, expected: bigint): boolean {
  if (expected === 0n) return observed === 0n;
  return abs(observed - expected) * 10_000n <= expected * 5n;
}

export function simulationMatchesProposalImpact(proposal: UnsignedProposal, simulation: SimulationResult): boolean {
  const expected = positiveImpactAmount(proposal);
  if (expected === 0n) return true;
  return simulation.balanceChanges
    .map((change) => parseAmount(change.amount))
    .filter((amount): amount is bigint => amount !== null)
    .map(abs)
    .some((amount) => withinTolerance(amount, expected));
}

function offlineSimulation(proposal: UnsignedProposal): SimulationResult {
  const impact = proposal.explain.financialImpact;
  const primary = positiveImpactAmount(proposal).toString();
  const currency = impact.currencyOut ?? impact.currencyIn ?? 'USDC';
  const balanceChanges = [{ owner: proposal.orgId, coinType: currency, amount: `-${primary}` }];
  // Cross-currency drafts (USD funded, PHP delivered) carry a distinct input
  // leg, so the policy match sees both the funding and the delivery amounts.
  const amountIn = impact.amountIn;
  if (typeof amountIn === 'bigint' && amountIn > 0n && amountIn.toString() !== primary) {
    balanceChanges.push({ owner: `${proposal.orgId}:funding`, coinType: impact.currencyIn ?? 'USD', amount: `-${amountIn.toString()}` });
  }
  return { ok: true, balanceChanges, gasSponsored: true, simulatedAt: new Date().toISOString() };
}

function failed(error: string): SimulationResult {
  return { ok: false, balanceChanges: [], gasSponsored: false, error, simulatedAt: new Date().toISOString() };
}

export async function simulateDraft(proposal: UnsignedProposal, env: NodeJS.ProcessEnv = process.env): Promise<UnsignedProposal> {
  if (env.OXWAL_CHAIN_MODE === 'live') {
    return {
      ...proposal,
      status: 'FAILED',
      simulation: failed('Live checks run in the payment flow on your vault. Create this payment from Transfer.'),
    };
  }
  const simulation = offlineSimulation(proposal);
  if (!simulationMatchesProposalImpact(proposal, simulation)) {
    return { ...proposal, status: 'FAILED', simulation: { ...simulation, ok: false, error: 'simulation mismatch' } };
  }
  return {
    ...proposal,
    status: 'SIMULATED',
    unsignedTxBytes: Buffer.from(JSON.stringify({ draft: proposal.id, mode: 'mock' })).toString('base64'),
    simulation,
  };
}
