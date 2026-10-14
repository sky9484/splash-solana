/**
 * Where outside money can come from for a payment (prompt 10 §5.6 "Add money another way"), behind one
 * `FundingRouter` interface.
 *
 * Adapters follow Phase A's decision table (docs/solana-build/FUNDING-AUDIT.md §7): every outside source
 * is a MOCK in this build, labelled test mode. The two real sources, the Payments account balance and a
 * move from the reserve, are not here: the planner reads them from the chain (funding-planner.ts).
 *
 * Hard rules, enforced here and tested:
 *   - the destination is always the company's own Payments account; Splash gives out no deposit
 *     address on any network;
 *   - only native USDC, and USDT, are accepted (PYUSD and other tokens: swap to USDC in your own wallet);
 *   - on an EVM network the token approval is for the exact amount only;
 *   - Splash's fee for adding money is US$0;
 *   - screening fails closed (an unknown result holds the money, funding-service.ts).
 *
 * The networks offered from another chain are the ones Phase A verified on Circle's page
 * (CCTP_DOMAINS in lib/solana/config.ts). Sui stays "Not available yet": Circle does not confirm CCTP
 * V2 there.
 */
import { CCTP_DOMAINS } from '../solana/config.ts';

export const WALLET_ASSETS = ['USDC', 'USDT', 'PYUSD', 'OTHER'] as const;
export type WalletAsset = (typeof WALLET_ASSETS)[number];

export const WALLET_NETWORKS = ['solana', 'ethereum', 'base', 'arbitrum', 'polygon', 'avalanche', 'sui'] as const;
export type WalletNetwork = (typeof WALLET_NETWORKS)[number];

/** How a network and an asset are named on screen (the crypto-wallet card is the allowed-jargon zone). */
export const NETWORK_LABEL: Record<WalletNetwork, string> = {
  solana: 'Solana',
  ethereum: 'Ethereum',
  base: 'Base',
  arbitrum: 'Arbitrum',
  polygon: 'Polygon',
  avalanche: 'Avalanche',
  sui: 'Sui',
};
export const ASSET_LABEL: Record<WalletAsset, string> = { USDC: 'USDC', USDT: 'USDT', PYUSD: 'PYUSD', OTHER: 'Another token' };

export type FundingSourceId = 'bank_card' | `wallet:${WalletAsset}:${WalletNetwork}`;

/** One way to bring money in, priced, with every step it takes in plain words. */
export interface FundingRoute {
  id: FundingSourceId;
  kind: 'bank_card' | 'wallet';
  label: string;
  asset: WalletAsset | 'USD';
  network: WalletNetwork | null;
  available: boolean;
  unavailableReason: string | null;
  /** Phase A's decision: 'mock' for every outside source in this build. */
  adapter: 'real' | 'mock';
  testMode: boolean;
  /** What happens, in order, ending in the company's own Payments account. */
  steps: string[];
  /** The third party's charge (a swap venue's, a top-up provider's): an estimate in test mode. Never Splash's. */
  chargeBps: number;
  chargeLabel: string;
  /** Splash's fee for adding money: always zero. */
  splashFeeBps: 0;
  /** Where the money lands: the company's own Payments account. Nothing else is allowed. */
  destination: string;
  /** EVM networks: the wallet approves exactly the amount, never an open allowance. */
  exactApproval: boolean;
}

export interface FundingRouter {
  routes(input: { destination: string }): FundingRoute[];
}

const SWAP_BPS = 20; // a swap venue's charge, test-mode estimate
const TOP_UP_BPS = 50; // a bank or card top-up provider's charge, test-mode estimate
const EVM: readonly WalletNetwork[] = ['ethereum', 'base', 'arbitrum', 'polygon', 'avalanche'];

function walletRoute(asset: WalletAsset, network: WalletNetwork, destination: string): FundingRoute {
  const id: FundingSourceId = `wallet:${asset}:${network}`;
  const base = {
    id,
    kind: 'wallet' as const,
    label: `${ASSET_LABEL[asset]} on ${NETWORK_LABEL[network]}`,
    asset,
    network,
    adapter: 'mock' as const,
    testMode: true,
    splashFeeBps: 0 as const,
    destination,
    exactApproval: EVM.includes(network),
  };
  const off = (reason: string): FundingRoute => ({ ...base, available: false, unavailableReason: reason, steps: [], chargeBps: 0, chargeLabel: 'No charge' });
  if (asset === 'PYUSD' || asset === 'OTHER') return off('Only USDC and USDT are accepted. Swap it to USDC in your own wallet first, then send that.');
  if (network === 'sui') return off('Not available yet: Circle’s transfer from Sui isn’t confirmed for this account type.');
  const evm = EVM.includes(network);
  if (evm && !(network in CCTP_DOMAINS)) return off('Not available yet.');
  const land = 'Lands in your Payments account';
  if (network === 'solana') {
    if (asset === 'USDC') return { ...base, available: true, unavailableReason: null, steps: ['Send from your wallet', land], chargeBps: 0, chargeLabel: 'No swap, no charge' };
    return { ...base, available: true, unavailableReason: null, steps: ['Swap USDT to USDC in your wallet', 'Send from your wallet', land], chargeBps: SWAP_BPS, chargeLabel: 'Swap charge (estimate)' };
  }
  const approve = `Approve exactly this amount in your wallet`;
  const circle = `Circle’s transfer from ${NETWORK_LABEL[network]}`;
  if (asset === 'USDC') return { ...base, available: true, unavailableReason: null, steps: [approve, circle, land], chargeBps: 0, chargeLabel: 'Circle charges nothing; your wallet pays its network fee' };
  return { ...base, available: true, unavailableReason: null, steps: ['Swap USDT to USDC in your wallet', approve, circle, land], chargeBps: SWAP_BPS, chargeLabel: 'Swap charge (estimate)' };
}

/** Test mode: every outside source is a labelled mock (Phase A §7). */
export function createTestModeFundingRouter(): FundingRouter {
  return {
    routes({ destination }) {
      if (!destination) throw new Error('a funding route needs the company’s own Payments account');
      const out: FundingRoute[] = [
        {
          id: 'bank_card',
          kind: 'bank_card',
          label: 'Bank or card top-up · test mode',
          asset: 'USD',
          network: null,
          available: true,
          unavailableReason: null,
          adapter: 'mock',
          testMode: true,
          steps: ['Pay by bank transfer or card', 'Converted to US dollars', 'Lands in your Payments account'],
          chargeBps: TOP_UP_BPS,
          chargeLabel: 'Top-up provider’s charge (estimate)',
          splashFeeBps: 0,
          destination,
          exactApproval: false,
        },
      ];
      for (const asset of WALLET_ASSETS) for (const network of WALLET_NETWORKS) out.push(walletRoute(asset, network, destination));
      return out;
    },
  };
}
