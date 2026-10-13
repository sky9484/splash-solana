/**
 * Solana chain-core configuration: program ids, mints, CCTP domains and run-mode env readers.
 *
 * Verified vs unverified (11 Oct 2026):
 *   Every id below was copied from a primary source (named on each line) and cross-checked against
 *   a second copy where one exists in this container: the Squads id against `@sqds/multisig`
 *   PROGRAM_ID, the CCTP V2 ids against `declare_id!` in circlefin/solana-cctp-contracts
 *   (commit ec16e95) and Mysten's cctp-kit, SAS against `sas-lib`. None has been checked on-chain by
 *   Splash: this container has no Solana RPC access. Each is therefore marked
 *   "source + unverified on-chain by Splash". `scripts/solana-devnet-e2e.ts` is the on-chain check.
 *
 * Env keys read here (SPLASH_SOLANA_MODE, SOLANA_CLUSTER, SOLANA_RPC_URL, KORA_RPC_URL) still need
 * declaring in lib/env.ts for `scripts/check-env-reads.mjs`; this layer may not edit that file.
 */
import { PublicKey } from '@solana/web3.js';

import { solanaAddressUrl, solanaTxUrl, solscanAccountUrl, solscanTxUrl } from '../explorer.ts';
import type { Cluster, RunMode } from './types.ts';

/** Programs that are the same address on devnet and mainnet-beta. */
export const SOLANA_PROGRAMS = {
  /** source: @sqds/multisig 2.1.4 PROGRAM_ID, Squads docs + unverified on-chain by Splash */
  squadsV4: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
  /** source: SPL Memo v2 (spl-memo) + unverified on-chain by Splash */
  memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  /** source: SPL Token (classic) + unverified on-chain by Splash */
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  /** source: SPL Associated Token Account + unverified on-chain by Splash */
  associatedToken: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  /** source: Solana runtime builtin + unverified on-chain by Splash */
  system: '11111111111111111111111111111111',
  /** source: Solana runtime builtin + unverified on-chain by Splash */
  computeBudget: 'ComputeBudget111111111111111111111111111111',
  /** source: circlefin/solana-cctp-contracts programs/v2/message-transmitter-v2 declare_id!, Mysten cctp-kit + unverified on-chain by Splash */
  cctpMessageTransmitterV2: 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
  /** source: circlefin/solana-cctp-contracts programs/v2/token-messenger-minter-v2 declare_id!, Mysten cctp-kit + unverified on-chain by Splash */
  cctpTokenMessengerMinterV2: 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
  /** source: sas-lib 1.0.x program address + unverified on-chain by Splash */
  sas: '22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG',
} as const;

/**
 * CCTP domain ids. Testnets reuse the mainnet domain (Polygon Amoy = 7).
 * source: https://developers.circle.com/cctp/concepts/supported-chains-and-domains, read 14 Oct 2026
 * (docs/solana-build/FUNDING-AUDIT.md §5). A network Circle does not confirm CCTP V2 for is not listed;
 * the crypto-wallet card shows it as "Not available yet" (lib/solana-app/funding-router.ts).
 */
export const CCTP_DOMAINS = {
  ethereum: 0,
  avalanche: 1,
  arbitrum: 3,
  solana: 5,
  base: 6,
  polygon: 7,
} as const;

/**
 * The tokens the Payments account accepts, pinned per cluster (FUNDING-AUDIT.md §8 step 4). Only
 * native USDC reaches the account today; USDT is pinned to Tether's own mint (CRIT-3: the canon's value
 * was wrong) and off until a payout partner accepts it, so a USDT holder swaps to USDC first.
 * source (USDC): https://developers.circle.com/stablecoins/usdc-contract-addresses
 * source (USDT): https://tether.to/en/supported-protocols/ ("Solana Token via Solana Blockchain")
 */
export const ALLOWED_DEPOSIT_MINTS: Record<Cluster, ReadonlyArray<{ symbol: 'USDC' | 'USDT'; mint: string; enabled: boolean }>> = {
  'mainnet-beta': [
    { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', enabled: true },
    { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', enabled: false },
  ],
  devnet: [{ symbol: 'USDC', mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', enabled: true }],
};

/** CCTP V2 minFinalityThreshold values. source: message-transmitter-v2 receive_message.rs (FINALIZED = 2000), Circle docs (fast = 1000). */
export const CCTP_FINALITY = {
  standard: 2000,
  fast: 1000,
} as const;

export const USDC_DECIMALS = 6;

export interface ClusterConfig {
  cluster: Cluster;
  /** Native Circle USDC, classic SPL Token mint (not Token-2022). */
  usdcMint: string;
  defaultRpcUrl: string;
  explorerCluster: string;
  programs: typeof SOLANA_PROGRAMS;
  cctpDomains: typeof CCTP_DOMAINS;
}

export const SOLANA_CONFIG: Record<Cluster, ClusterConfig> = {
  devnet: {
    cluster: 'devnet',
    /** source: Circle USDC docs (devnet) + unverified on-chain by Splash */
    usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    defaultRpcUrl: 'https://api.devnet.solana.com',
    explorerCluster: 'devnet',
    programs: SOLANA_PROGRAMS,
    cctpDomains: CCTP_DOMAINS,
  },
  'mainnet-beta': {
    cluster: 'mainnet-beta',
    /** source: Circle USDC docs (mainnet) + unverified on-chain by Splash */
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    defaultRpcUrl: 'https://api.mainnet-beta.solana.com',
    explorerCluster: 'mainnet-beta',
    programs: SOLANA_PROGRAMS,
    cctpDomains: CCTP_DOMAINS,
  },
};

/** PublicKey form of the program table, built once. */
export const PROGRAM_IDS = Object.freeze(
  Object.fromEntries(Object.entries(SOLANA_PROGRAMS).map(([k, v]) => [k, new PublicKey(v)])) as {
    [K in keyof typeof SOLANA_PROGRAMS]: PublicKey;
  },
);

export function clusterConfig(cluster: Cluster): ClusterConfig {
  const config = SOLANA_CONFIG[cluster];
  if (!config) throw new Error(`Unknown Solana cluster: ${String(cluster)}`);
  return config;
}

export function usdcMint(cluster: Cluster): PublicKey {
  return new PublicKey(clusterConfig(cluster).usdcMint);
}

/** On a named cluster; the URL itself is built in lib/explorer.ts. */
export function explorerTxUrl(signature: string, cluster: Cluster): string {
  return solanaTxUrl(signature, cluster);
}

export function explorerAddressUrl(address: string, cluster: Cluster): string {
  return solanaAddressUrl(address, cluster);
}

/** Solscan, the trace link shown first. */
export function solscanTx(signature: string, cluster: Cluster): string {
  return solscanTxUrl(signature, cluster);
}

export function solscanAccount(address: string, cluster: Cluster): string {
  return solscanAccountUrl(address, cluster);
}

export interface SolanaEnv {
  mode: RunMode;
  cluster: Cluster;
  rpcUrl: string;
  /** null when unset: devnet mode then refuses to send sponsored transactions. */
  koraRpcUrl: string | null;
}

const RUN_MODES: readonly RunMode[] = ['offline', 'devnet'];
const CLUSTERS: readonly Cluster[] = ['devnet', 'mainnet-beta'];

/**
 * Read the run-mode env. Defaults: offline, devnet. Unknown values throw rather than fall back,
 * so a typo can never silently put the app on a network. `mainnet-beta` is refused in this build:
 * nothing here has been run on devnet yet.
 */
export function readSolanaEnv(env: NodeJS.ProcessEnv = process.env): SolanaEnv {
  const rawMode = (env.SPLASH_SOLANA_MODE ?? 'offline').trim();
  if (!RUN_MODES.includes(rawMode as RunMode)) {
    throw new Error(`SPLASH_SOLANA_MODE must be one of ${RUN_MODES.join(', ')}; got "${rawMode}"`);
  }
  const rawCluster = (env.SOLANA_CLUSTER ?? 'devnet').trim();
  if (!CLUSTERS.includes(rawCluster as Cluster)) {
    throw new Error(`SOLANA_CLUSTER must be one of ${CLUSTERS.join(', ')}; got "${rawCluster}"`);
  }
  const cluster = rawCluster as Cluster;
  if (cluster === 'mainnet-beta') {
    throw new Error('SOLANA_CLUSTER=mainnet-beta is not enabled in the Colosseum build');
  }
  const rpcUrl = env.SOLANA_RPC_URL?.trim() || clusterConfig(cluster).defaultRpcUrl;
  const koraRpcUrl = env.KORA_RPC_URL?.trim() || null;
  for (const [name, url] of [['SOLANA_RPC_URL', rpcUrl], ['KORA_RPC_URL', koraRpcUrl]] as const) {
    if (url && !/^https?:\/\//.test(url)) throw new Error(`${name} must be an http(s) URL`);
  }
  return { mode: rawMode as RunMode, cluster, rpcUrl, koraRpcUrl };
}
