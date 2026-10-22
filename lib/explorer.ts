/**
 * Explorer links that follow the cluster.
 *
 * A receipt whose "verify this yourself" link points at the wrong network
 * proves nothing: the transaction does not exist there. So which explorer, and
 * which cluster, is decided once, here.
 *
 * Solana Explorer keeps the cluster in a query parameter; mainnet-beta has
 * none. The cluster is SOLANA_CLUSTER on the server and
 * NEXT_PUBLIC_SOLANA_CLUSTER on the client, devnet unless told otherwise.
 */

export type ExplorerCluster = 'devnet' | 'mainnet-beta';

export function explorerCluster(env: NodeJS.ProcessEnv = process.env): ExplorerCluster {
  return env.SOLANA_CLUSTER === 'mainnet-beta' || env.NEXT_PUBLIC_SOLANA_CLUSTER === 'mainnet-beta'
    ? 'mainnet-beta'
    : 'devnet';
}

function suffix(cluster: ExplorerCluster): string {
  return cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
}

/** Solana Explorer transaction page. */
export function solanaTxUrl(signature: string, cluster: ExplorerCluster = explorerCluster()): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${suffix(cluster)}`;
}

/** Solana Explorer account page: a vault, a token account, an attestation. */
export function solanaAddressUrl(address: string, cluster: ExplorerCluster = explorerCluster()): string {
  return `https://explorer.solana.com/address/${encodeURIComponent(address)}${suffix(cluster)}`;
}

/** Solana Explorer root for the active cluster, for a general "open the explorer" link. */
export function solanaExplorerBaseUrl(cluster: ExplorerCluster = explorerCluster()): string {
  return `https://explorer.solana.com/${suffix(cluster)}`;
}

/**
 * Circle's USDC faucet on devnet, or null on mainnet — where there is no
 * faucet, and offering one is an invitation to look for free money.
 */
export function faucetUrl(cluster: ExplorerCluster = explorerCluster()): string | null {
  return cluster === 'mainnet-beta' ? null : 'https://faucet.circle.com/';
}
