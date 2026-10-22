// iso-ui
// copy: technical
'use client';

import { Wallet } from 'lucide-react';

import { IsoButton, IsoSurface, Tag } from '@/components/iso';

/**
 * Balance › Add money › "From a crypto wallet" (prompt 10 §5.10): the allowed-jargon zone, where the
 * assets and networks are named. It opens the same funding sheet as Transfer's Step 3.
 */
export function BalanceWalletCard({ onChoose }: { onChoose: () => void }) {
  return (
    <IsoSurface pad className="iso-stack iso-addcard" aria-labelledby="bal-wallet">
      <Tag tone="ink">
        <Wallet size={14} aria-hidden="true" /> Your own wallet
      </Tag>
      <h3 id="bal-wallet" className="iso-h3">
        From a crypto wallet
      </h3>
      <p className="iso-small" style={{ margin: 0 }}>
        USDC or USDT on Solana, Ethereum, Base, Arbitrum, Polygon or Avalanche. You send it from your own wallet; it arrives as US dollars in your Payments account. Splash fee: US$0.
      </p>
      <div className="iso-addcard__act">
        <IsoButton variant="quiet" onClick={onChoose}>
          Choose a wallet
        </IsoButton>
      </div>
    </IsoSurface>
  );
}
