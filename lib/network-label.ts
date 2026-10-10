/**
 * W9.2 — the receipt's network line reads from the runtime profile so it
 * flips to "Sui mainnet" automatically at launch (config change, no code).
 *
 * Server code resolves via SUI_NETWORK (lib/sui.ts). Client components see
 * NEXT_PUBLIC_SUI_NETWORK, which the W5 mainnet profile sets alongside
 * SUI_NETWORK — until then the client default is the sandbox line, which is
 * the honest state.
 */
export function receiptNetworkLine(): string {
  const network =
    process.env.SUI_NETWORK === 'mainnet' || process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet'
      ? 'mainnet'
      : 'testnet';
  return network === 'mainnet' ? 'Sui mainnet' : 'Sui · sandbox, no customer funds';
}
