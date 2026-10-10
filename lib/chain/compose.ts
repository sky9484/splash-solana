import { Transaction } from '@mysten/sui/transactions';

import type { SimulationResult, UnsignedProposal } from '../agent/types.ts';

type SuiBalanceOwner =
  | string
  | { AddressOwner: string }
  | { ObjectOwner: string }
  | { Shared: unknown }
  | { Immutable: true };

type SuiDryRunBalanceChange = {
  owner: SuiBalanceOwner;
  coinType: string;
  amount: string;
};

type SuiDryRunResult = {
  balanceChanges: SuiDryRunBalanceChange[];
  effects?: { status?: { status?: string; error?: string } };
};

export type ChainDryRunClient = {
  dryRunTransactionBlock(input: { transactionBlock: Uint8Array | string }): Promise<SuiDryRunResult>;
};

export type SponsoredTransactionBytes = {
  txBytes: string;
  sponsorSignature?: string;
  txDigest?: string;
  sponsor: 'enoki' | 'shinami' | 'mock';
};

export type GasSponsorAdapter = {
  sponsorTransaction(input: {
    txKind: string;
    sender: string;
    gasBudget?: number | string;
  }): Promise<SponsoredTransactionBytes>;
};

export type ComposeOptions = {
  client?: ChainDryRunClient;
  sponsor?: GasSponsorAdapter;
  sender?: string;
  gasBudget?: number | string;
  mode?: 'mock' | 'live';
};

const DEFAULT_SENDER = '0x0000000000000000000000000000000000000000000000000000000000000001';
const DEFAULT_GAS_BUDGET = '10000000';

function toBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function ownerToString(owner: SuiBalanceOwner): string {
  if (typeof owner === 'string') return owner;
  if ('AddressOwner' in owner) return owner.AddressOwner;
  if ('ObjectOwner' in owner) return owner.ObjectOwner;
  if ('Shared' in owner) return 'SHARED';
  return 'IMMUTABLE';
}

function positiveImpactAmount(proposal: UnsignedProposal) {
  return proposal.explain.financialImpact.amountOut
    ?? proposal.explain.financialImpact.amountIn
    ?? BigInt(0);
}

function abs(value: bigint) {
  return value < BigInt(0) ? -value : value;
}

function parseAmount(value: string) {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function withinTolerance(observed: bigint, expected: bigint) {
  if (expected === BigInt(0)) return observed === BigInt(0);
  return abs(observed - expected) * BigInt(10_000) <= expected * BigInt(5);
}

export function simulationMatchesProposalImpact(
  proposal: UnsignedProposal,
  simulation: SimulationResult,
) {
  const expected = positiveImpactAmount(proposal);
  if (expected === BigInt(0)) return true;
  return simulation.balanceChanges
    .map((change) => parseAmount(change.amount))
    .filter((amount): amount is bigint => amount !== null)
    .map(abs)
    .some((amount) => withinTolerance(amount, expected));
}

function proposalMoveTarget(proposal: UnsignedProposal) {
  const configured = process.env[`OXWAL_MOVE_TARGET_${proposal.kind}`];
  if (configured) return configured;
  return `0x2::oxwal_placeholder::${proposal.kind.toLowerCase()}`;
}

export function buildProposalTransactionKind(proposal: UnsignedProposal) {
  const tx = new Transaction();
  const amount = positiveImpactAmount(proposal);
  tx.moveCall({
    target: proposalMoveTarget(proposal),
    arguments: [
      tx.pure.string(proposal.id),
      tx.pure.string(proposal.orgId),
      tx.pure.string(proposal.kind),
      tx.pure.u64(amount.toString()),
      tx.pure.string(proposal.explain.reasoningTraceRef),
    ],
  });
  return tx;
}

function mockSponsoredBytes(txKind: string, sender: string): SponsoredTransactionBytes {
  return {
    txBytes: Buffer.from(JSON.stringify({ txKind, sender, sponsored: true, mode: 'mock' })).toString('base64'),
    sponsorSignature: 'MOCK_SPONSOR_SIGNATURE',
    txDigest: `MOCK_${Buffer.from(txKind).toString('hex').slice(0, 40)}`,
    sponsor: 'mock',
  };
}

function mockSimulationForProposal(proposal: UnsignedProposal): SuiDryRunResult {
  const impact = proposal.explain.financialImpact;
  const primary = positiveImpactAmount(proposal).toString();
  const currency = impact.currencyOut ?? impact.currencyIn ?? 'USDC';
  const balanceChanges: SuiDryRunResult['balanceChanges'] = [
    {
      owner: { AddressOwner: proposal.orgId },
      coinType: currency,
      amount: `-${primary}`,
    },
  ];

  // Cross-currency proposals (e.g. USD funded → PHP delivered) carry a distinct
  // input leg. Reflect it so the policy simulation-match check sees both the
  // funding and the delivery amounts, not just one.
  const amountIn = impact.amountIn;
  if (typeof amountIn === 'bigint' && amountIn > BigInt(0) && amountIn.toString() !== primary) {
    balanceChanges.push({
      owner: { AddressOwner: `${proposal.orgId}:funding` },
      coinType: impact.currencyIn ?? 'USD',
      amount: `-${amountIn.toString()}`,
    });
  }

  return { effects: { status: { status: 'success' } }, balanceChanges };
}

function normalizeDryRun(result: SuiDryRunResult): SimulationResult {
  const status = result.effects?.status;
  return {
    ok: status?.status !== 'failure' && !status?.error,
    balanceChanges: result.balanceChanges.map((change) => ({
      owner: ownerToString(change.owner),
      coinType: change.coinType,
      amount: change.amount,
    })),
    gasSponsored: true,
    error: status?.error,
    simulatedAt: new Date().toISOString(),
  };
}

function failedSimulation(error: string): SimulationResult {
  return {
    ok: false,
    balanceChanges: [],
    gasSponsored: false,
    error,
    simulatedAt: new Date().toISOString(),
  };
}

export async function composeAndSimulateProposal(
  proposal: UnsignedProposal,
  options: ComposeOptions = {},
): Promise<UnsignedProposal> {
  const mode = options.mode ?? (process.env.OXWAL_CHAIN_MODE === 'live' ? 'live' : 'mock');
  const sender = options.sender ?? process.env.OXWAL_SUI_SENDER ?? DEFAULT_SENDER;
  const gasBudget = options.gasBudget ?? process.env.OXWAL_GAS_BUDGET ?? DEFAULT_GAS_BUDGET;

  try {
    const tx = buildProposalTransactionKind(proposal);
    tx.setSender(sender);
    const kindBytes = await tx.build({ onlyTransactionKind: true });
    const txKind = toBase64(kindBytes);

    const sponsored = mode === 'mock'
      ? mockSponsoredBytes(txKind, sender)
      : await requireSponsor(options.sponsor).sponsorTransaction({ txKind, sender, gasBudget });

    const dryRun = mode === 'mock'
      ? mockSimulationForProposal(proposal)
      : await requireClient(options.client).dryRunTransactionBlock({
          transactionBlock: fromBase64(sponsored.txBytes),
        });
    const simulation = normalizeDryRun(dryRun);

    if (!simulation.ok) {
      return {
        ...proposal,
        status: 'FAILED',
        unsignedTxBytes: sponsored.txBytes,
        simulation,
      };
    }

    if (!simulationMatchesProposalImpact(proposal, simulation)) {
      return {
        ...proposal,
        status: 'FAILED',
        unsignedTxBytes: sponsored.txBytes,
        simulation: {
          ...simulation,
          ok: false,
          error: 'simulation mismatch',
        },
      };
    }

    return {
      ...proposal,
      status: 'SIMULATED',
      unsignedTxBytes: sponsored.txBytes,
      simulation,
    };
  } catch (error) {
    return {
      ...proposal,
      status: 'FAILED',
      simulation: failedSimulation(error instanceof Error ? error.message : 'composition failed'),
    };
  }
}

function requireClient(client: ChainDryRunClient | undefined): ChainDryRunClient {
  if (!client) {
    throw new Error('Sui dry-run client is required in live chain mode');
  }
  return client;
}

function requireSponsor(sponsor: GasSponsorAdapter | undefined): GasSponsorAdapter {
  if (!sponsor) {
    throw new Error('gas sponsor adapter is required in live chain mode');
  }
  return sponsor;
}
