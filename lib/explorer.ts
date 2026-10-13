/**
 * Explorer links that follow the cluster.
 *
 * A receipt whose "verify this yourself" link points at the wrong network
 * proves nothing: the transaction does not exist there. So which explorer, and
 * which cluster, is decided once, here.
 *
 * Solscan is the trace link Splash shows first (Sky, 13 Oct 2026): a payment
 * is followed on Solscan from the vault account to each transaction, and the
 * execute's program logs show the memo "splash:pay:v1:<paymentId>". Solana
 * Explorer stays as the second link on the receipt's verify steps.
 *
 * Both keep the cluster in a query parameter (`?cluster=devnet`); mainnet-beta
 * has none. The cluster is SOLANA_CLUSTER on the server and
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

/** Solscan transaction page: the first link a person follows. */
export function solscanTxUrl(signature: string, cluster: ExplorerCluster = explorerCluster()): string {
  return `https://solscan.io/tx/${encodeURIComponent(signature)}${suffix(cluster)}`;
}

/** Solscan account page: a vault (every transaction it took part in), a token account, a deposit address. */
export function solscanAccountUrl(address: string, cluster: ExplorerCluster = explorerCluster()): string {
  return `https://solscan.io/account/${encodeURIComponent(address)}${suffix(cluster)}`;
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
