// iso-ui
// copy: technical
'use client';

import bs58 from 'bs58';

import { Combobox, IsoButton, Segmented, TestModeBadge, TextField } from '@/components/iso';

import type { FundingOptionsDTO } from '../types';

type Route = FundingOptionsDTO['routes'][number];
export type Asset = 'USDC' | 'USDT' | 'PYUSD' | 'OTHER';
/** What the sheet starts on: the asset most wallets hold. */
export const FIRST_ASSET: Asset = 'USDC';

const ASSETS: Array<{ value: Asset; label: string }> = [
  { value: 'USDC', label: 'USDC' },
  { value: 'USDT', label: 'USDT' },
  { value: 'PYUSD', label: 'PYUSD' },
  { value: 'OTHER', label: 'Another token' },
];

/** A random address for the test wallet, in the network's own format (test mode only: nothing is sent). */
function testAddress(network: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(network === 'solana' ? 32 : 20));
  return network === 'solana' ? bs58.encode(bytes) : `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * "From a crypto wallet" (prompt 10 §5.6): the allowed-jargon zone, where asset and network names are
 * needed. What you hold, then which network, then the route the planner priced, step by step, ending
 * in the company's own Payments account. Splash gives out no deposit address: the money comes from a
 * wallet the person controls, and only USDC and USDT are accepted. Every route is test mode here.
 */
export function CryptoWallet({
  routes,
  asset,
  onAsset,
  network,
  onNetwork,
  fromAddress,
  onFromAddress,
  amountLabel,
  disabled,
}: {
  routes: Route[];
  asset: Asset;
  onAsset: (a: Asset) => void;
  network: string | null;
  onNetwork: (n: string) => void;
  fromAddress: string;
  onFromAddress: (a: string) => void;
  /** "US$1,250.00": what the wallet sends. */
  amountLabel: string;
  disabled: boolean;
}) {
  const forAsset = routes.filter((r) => r.kind === 'wallet' && r.asset === asset);
  const route = forAsset.find((r) => r.network === network) ?? null;
  const assetOff = forAsset.length > 0 && forAsset.every((r) => !r.available);
  return (
    <div className="iso-stack">
      <div className="iso-field">
        <span className="iso-field__label">What you hold</span>
        <Segmented label="What you hold" value={asset} onChange={onAsset} options={ASSETS} />
      </div>
      {assetOff ? (
        <p className="iso-note iso-note--amber">{forAsset[0]!.unavailableReason}</p>
      ) : (
        <Combobox
          label="Which network"
          options={forAsset.map((r) => ({ value: r.network ?? '', label: r.label.replace(/^.* on /, ''), meta: r.available ? (r.chargeBps > 0 ? 'Swap first' : 'No charge') : 'Not available yet', disabled: !r.available }))}
          value={network}
          onChange={onNetwork}
          placeholder="Choose the network your wallet is on"
        />
      )}
      {route && route.available ? (
        <div className="iso-stack">
          <ol className="iso-steps-list">
            {route.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="iso-small" style={{ margin: 0 }}>
            {route.chargeLabel}. Your wallet sends {amountLabel}
            {route.exactApproval ? ', and approves exactly that amount, never an open allowance' : ''}. It lands in your own Payments account, never with Splash.
          </p>
          <TextField
            label="Your wallet’s address"
            value={fromAddress}
            onChange={onFromAddress}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            help={route.network === 'solana' ? 'The address you send from. It’s screened before the money counts.' : 'The 0x… address you send from. It’s screened before the money counts.'}
            end={
              <IsoButton variant="link" size="sm" onClick={() => onFromAddress(testAddress(route.network ?? 'solana'))} disabled={disabled}>
                Use a test wallet
              </IsoButton>
            }
          />
          <p className="iso-small iso-row" style={{ margin: 0 }}>
            <TestModeBadge inline label="Test mode" /> No wallet opens in test mode: approving below stands in for approving in your wallet.
          </p>
        </div>
      ) : route ? (
        <p className="iso-note iso-note--amber">{route.unavailableReason}</p>
      ) : null}
    </div>
  );
}
