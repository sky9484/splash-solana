'use client';

import Link from 'next/link';

import { usd } from './client';

/** Micro-USDC rounded UP to a whole cent, so a move of this size always covers the gap. */
export function ceilToCent(minor: bigint): bigint {
  return ((minor + 9_999n) / 10_000n) * 10_000n;
}

const big = (v: unknown) => {
  try {
    return BigInt(String(v ?? '0'));
  } catch {
    return 0n;
  }
};

/**
 * The payments vault cannot cover a payment (the quote answered `insufficient_balance`). Payments
 * leave only from the payments vault, so it says by how much, and offers the two ways to fund it:
 * a move from the company's own treasury (prefilled, coming back here after), or adding USDC.
 */
export function ShortfallNotice({ detail, back, onRetry, busy }: { detail?: Record<string, unknown>; back: string; onRetry?: () => void; busy?: boolean }) {
  const short = big(detail?.shortUsdcMinor);
  const treasury = big(detail?.treasuryUsdcMinor);
  const balance = big(detail?.balanceUsdcMinor);
  const move = ceilToCent(short > 0n ? short : 0n);
  const canMove = move > 0n && treasury >= move;
  return (
    <div className="sx-notice sx-notice-warn sx-stack" role="alert">
      <div>
        <h3>Your payments vault is {usd(move)} short</h3>
        <p className="sx-small">
          It holds {usd(balance)}. Payments leave only from the payments vault, so fund it first
          {treasury > 0n ? `: your treasury holds ${usd(treasury)}.` : '.'}
        </p>
      </div>
      <div className="sx-row">
        {canMove ? (
          <Link className="sx-btn sx-btn-sm" href={`/dashboard/treasury?move=${move}&back=${encodeURIComponent(back)}`}>
            Move {usd(move)} from treasury
          </Link>
        ) : null}
        <Link className={canMove ? 'sx-btn sx-btn-ghost sx-btn-sm' : 'sx-btn sx-btn-sm'} href="/dashboard/fund">
          Add USDC
        </Link>
        {onRetry ? (
          <button type="button" className="sx-btn-link" onClick={onRetry} disabled={busy}>
            Funded it? Quote again
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The payments vault is empty: nothing can be paid until it is funded. */
export function EmptyVaultNotice({ treasuryMinor }: { treasuryMinor: string }) {
  const treasury = big(treasuryMinor);
  return (
    <div className="sx-notice sx-notice-warn sx-stack">
      <div>
        <h3>Your payments vault is empty</h3>
        <p className="sx-small">Fund it before you pay: move USDC in from your treasury{treasury > 0n ? ` (it holds ${usd(treasury)})` : ''}, or add USDC.</p>
      </div>
      <div className="sx-row">
        {treasury > 0n ? (
          <Link className="sx-btn sx-btn-sm" href="/dashboard/treasury">
            Move from treasury
          </Link>
        ) : null}
        <Link className={treasury > 0n ? 'sx-btn sx-btn-ghost sx-btn-sm' : 'sx-btn sx-btn-sm'} href="/dashboard/fund">
          Add USDC
        </Link>
      </div>
    </div>
  );
}
