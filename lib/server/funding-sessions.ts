import 'server-only';

import { randomUUID } from 'node:crypto';

import { formatMinor } from '@/lib/money';

import {
  fundingMethodForSelection,
  resolveFundingSelection,
  type FundingFeeTier,
  type FundingSourceId,
  type FundingSelection,
  type StablecoinAssetSymbol,
  type StablecoinRail,
  type CctpSourceChain,
} from '@/lib/funding/registry';
import type { FundingSourceType } from '@/lib/funding/kyt-policy';

export type FundingSessionStatus =
  | 'AWAITING_DEPOSIT'
  | 'PENDING_KYT'
  | 'CLEARED'
  | 'PENDING_CONVERT'
  | 'QUARANTINED'
  | 'CREDITED';

export type FundingSession = {
  id: string;
  /** The tenant this deposit credits. The on-chain account id below is NOT a
   *  tenant key — it falls back to a value shared across orgs — so the ledger
   *  credit is keyed by this. */
  orgId: string;
  businessAccountId: string;
  selection: FundingSelection;
  feeTier: FundingFeeTier;
  amountExpectedMicro: number;
  depositAddress?: string;
  depositUri?: string;
  status: FundingSessionStatus;
  sourceType?: FundingSourceType;
  kytPolicy?: 'STANDARD' | 'ENHANCED';
  kytReasons?: string[];
  sourceTxDigest?: string;
  receivedMint?: string;
  receivedAmountMicro?: number;
  /** True when the deposit arrived as native Circle USDC on Solana (directly or minted by CCTP). */
  nativeUsdc?: boolean;
  normalizedAmountUsdcMicro?: number;
  normalizeVenue?: 'PASSTHROUGH';
  effectiveSlippageBps?: number;
  transferIntentId?: string;
  adminFlag?: string;
  createdAt: string;
  updatedAt: string;
};

type FundingSessionStore = {
  sessions: Map<string, FundingSession>;
  sourceTransactions: Map<string, string>;
  lastUsedSources: Map<string, FundingSourceId>;
};

const globalStore = globalThis as typeof globalThis & { splashFundingSessions?: FundingSessionStore };
const store = globalStore.splashFundingSessions ?? {
  sessions: new Map<string, FundingSession>(),
  sourceTransactions: new Map<string, string>(),
  lastUsedSources: new Map<string, FundingSourceId>(),
};
globalStore.splashFundingSessions = store;

/**
 * Where a deposit goes. Native USDC on Solana goes straight to the org's own
 * Squads vault: Splash derives no deposit key and holds nothing in between.
 *
 * A CCTP deposit from another chain is refused (CRIT-1, docs/solana-build/FUNDING-AUDIT.md): this
 * code used to hand out an address on the source chain that was not the company's own account. Money
 * from another chain arrives through Circle's transfer straight into the company's own Payments
 * account (Transfer's "Add money another way"), never through an address Splash gives out.
 */
function stablecoinDepositAddress(selection: Extract<FundingSelection, { type: 'stablecoin' }>, vaultAddress: string | null) {
  if (selection.rail === 'SOLANA') {
    if (!vaultAddress) throw new Error('This workspace has no vault yet. Finish setup to get a deposit address.');
    return vaultAddress;
  }
  throw new Error(`A deposit from ${selection.sourceChain ?? 'another chain'} has no address here: it lands only in your own Payments account.`);
}

/** A Solana Pay request for a vault deposit; a plain address URI for a CCTP source chain. */
function depositUri(
  address: string,
  selection: Extract<FundingSelection, { type: 'stablecoin' }>,
  amountExpectedMicro: number,
  mint: string | undefined,
) {
  const amount = formatMinor(BigInt(amountExpectedMicro), 6);
  if (selection.rail === 'SOLANA') {
    const params = new URLSearchParams({ amount });
    if (mint) params.set('spl-token', mint);
    params.set('label', 'Splash vault deposit');
    return `solana:${address}?${params.toString()}`;
  }
  const params = new URLSearchParams({ asset: selection.asset, amount });
  if (selection.sourceChain) params.set('sourceChain', selection.sourceChain);
  return `ethereum:${address}?${params.toString()}`;
}

export function createFundingSession(input: {
  orgId: string;
  businessAccountId: string;
  selection: FundingSelection;
  amountExpectedMicro: number;
  /** The org's Squads vault (org_vaults.vault_pda), or null before setup. */
  vaultAddress?: string | null;
}, env: NodeJS.ProcessEnv = process.env) {
  const { asset } = resolveFundingSelection(input.selection, env);
  if (input.selection.type === 'held') {
    throw new Error('Vault balance funding settles without a funding session');
  }
  if (!Number.isSafeInteger(input.amountExpectedMicro) || input.amountExpectedMicro <= 0) {
    throw new Error('Funding amount must be a positive integer in micro units');
  }

  const now = new Date().toISOString();
  const stablecoinSelection = input.selection.type === 'stablecoin' ? input.selection : null;
  const address = stablecoinSelection
    ? stablecoinDepositAddress(stablecoinSelection, input.vaultAddress ?? null)
    : undefined;
  const session: FundingSession = {
    id: `fund_${randomUUID()}`,
    orgId: input.orgId,
    businessAccountId: input.businessAccountId,
    selection: input.selection,
    feeTier: input.selection.feeTier,
    amountExpectedMicro: input.amountExpectedMicro,
    depositAddress: address,
    depositUri: address && stablecoinSelection
      ? depositUri(address, stablecoinSelection, input.amountExpectedMicro, asset?.mint)
      : undefined,
    status: 'AWAITING_DEPOSIT',
    createdAt: now,
    updatedAt: now,
  };
  store.sessions.set(session.id, session);
  recordLastUsedFundingSource(input.businessAccountId, input.selection.source);
  return session;
}

export function readFundingSession(sessionId: string) {
  return store.sessions.get(sessionId) ?? null;
}

export function listFundingSessions() {
  return [...store.sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function updateFundingSession(sessionId: string, patch: Partial<FundingSession>) {
  const session = readFundingSession(sessionId);
  if (!session) return null;
  Object.assign(session, patch, { updatedAt: new Date().toISOString() });
  store.sessions.set(sessionId, session);
  return session;
}

export function registerSourceTransaction(txDigest: string, sessionId: string) {
  const existing = store.sourceTransactions.get(txDigest);
  if (existing && existing !== sessionId) throw new Error('Source transaction was already assigned to another funding session');
  store.sourceTransactions.set(txDigest, sessionId);
}

export function readLastUsedFundingSource(businessAccountId: string) {
  return store.lastUsedSources.get(businessAccountId) ?? null;
}

export function recordLastUsedFundingSource(businessAccountId: string, source: FundingSourceId) {
  store.lastUsedSources.set(businessAccountId, source);
}

export function assetDetails(session: FundingSession): {
  asset: StablecoinAssetSymbol;
  rail: StablecoinRail;
  sourceChain?: CctpSourceChain;
} | null {
  if (fundingMethodForSelection(session.selection) !== 'STABLECOIN') return null;
  if (session.selection.type !== 'stablecoin') return null;
  return {
    asset: session.selection.asset,
    rail: session.selection.rail,
    sourceChain: session.selection.sourceChain,
  };
}
