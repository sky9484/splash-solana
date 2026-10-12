/**
 * The receipt's network line, from the runtime profile, so it changes with
 * the cluster (config, no code). Server code reads SOLANA_CLUSTER; client
 * components see NEXT_PUBLIC_SOLANA_CLUSTER. Until mainnet is enabled the
 * line is the sandbox one, which is the honest state.
 */
import { explorerCluster } from './explorer.ts';

export function receiptNetworkLine(): string {
  return explorerCluster() === 'mainnet-beta' ? 'Solana' : 'Solana devnet · sandbox, no customer funds';
}
