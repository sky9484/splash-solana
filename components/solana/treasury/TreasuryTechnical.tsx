// iso-ui
// copy: technical
'use client';

import { Details } from '@/components/iso';

import type { TreasuryDTO } from './Treasury';

/**
 * Treasury's "Technical details" (prompt 10 §0.6: the one place on the page where crypto words are
 * allowed): which account holds the investments, the T-bills token on Solana and where its address
 * comes from, and what is still an assumption.
 */
export function TreasuryTechnical({ data }: { data: TreasuryDTO }) {
  const t = data.technical;
  return (
    <Details summary="Technical details">
      <dl className="iso-dl iso-dl--rows">
        <div>
          <dt>Investments account</dt>
          <dd className="iso-mono" style={{ overflowWrap: 'anywhere' }}>
            {t.investmentsAccount ?? 'Not set up yet'}
          </dd>
        </div>
        <div>
          <dt>What it is</dt>
          <dd>Vault #2 of your company’s Squads multisig: the same members and approvals as your Payments account (#0) and Reserve (#1). No one else has permission on it.</dd>
        </div>
        <div>
          <dt>T-bills token on Solana</dt>
          <dd className="iso-mono" style={{ overflowWrap: 'anywhere' }}>
            USDY · {t.usdyMint} ·{' '}
            <a href={t.usdyMintSource} target="_blank" rel="noreferrer">
              Ondo’s address list
            </a>
          </dd>
        </div>
        <div>
          <dt>Stock tokens</dt>
          <dd>SPYon, QQQon, NVDAon, GOOGLon, TSLAon (Ondo). Their addresses aren’t checked against Ondo’s documentation yet, so none is used.</dd>
        </div>
        <div>
          <dt>The {data.tbills.holdDays}-day hold</dt>
          <dd>
            A cautious assumption: Ondo’s USDY page doesn’t state a holding period after a subscription (
            <a href={t.holdSource} target="_blank" rel="noreferrer">
              checked
            </a>
            ). Until it’s confirmed, units bought straight from Ondo are held {data.tbills.holdDays} days here.
          </dd>
        </div>
        <div>
          <dt>Test mode</dt>
          <dd>Orders are off-chain: your device approves the exact order text, and a simulator plays the market and Ondo. Prices are test prices, not live quotes.</dd>
        </div>
      </dl>
    </Details>
  );
}
