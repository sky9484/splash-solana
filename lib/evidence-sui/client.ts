import { SuiGrpcClient } from '@mysten/sui/grpc';

/**
 * The Sui client the EVIDENCE layer uses, and nothing else.
 *
 * On the Solana build Sui is an invisible dependency of evidence only: Seal
 * encrypts each evidence bundle under the organisation's allowlist, and
 * Walrus stores the ciphertext. Settlement, approvals and fees are Solana.
 * This directory (lib/evidence-sui/) is the only place allowed to import
 * `@mysten/*`; tests/solana-boundary.test.mjs and the ESLint rule enforce it.
 *
 * Its own network and RPC keys, so nothing about evidence depends on the
 * Sui settlement code that the Solana build removed.
 */

export type EvidenceSuiNetwork = 'testnet' | 'mainnet';

export function evidenceSuiNetwork(env: NodeJS.ProcessEnv = process.env): EvidenceSuiNetwork {
  return env.EVIDENCE_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

export function evidenceSuiRpcUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.EVIDENCE_SUI_RPC_URL?.trim() || `https://fullnode.${evidenceSuiNetwork(env)}.sui.io:443`;
}

const globalClient = globalThis as typeof globalThis & { splashEvidenceSuiClient?: SuiGrpcClient };

export function evidenceSuiClient(): SuiGrpcClient {
  if (!globalClient.splashEvidenceSuiClient) {
    globalClient.splashEvidenceSuiClient = new SuiGrpcClient({ network: evidenceSuiNetwork(), baseUrl: evidenceSuiRpcUrl() });
  }
  return globalClient.splashEvidenceSuiClient;
}
