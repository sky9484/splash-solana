'use client';

import Link from 'next/link';
import { useState } from 'react';

import { BalanceHeader } from './BalanceHeader';
import { copyText, dateShort, payHref, php, shortKey, usd } from './client';
import { StatusPill } from './StatusPill';
import { useCompany } from './useCompany';

/**
 * The dashboard's first screen (prompt 07 §6.2): the vault's USDC balance, read from its token account;
 * what is waiting for a person's approval; and the last five payments with their state.
 */
export function Overview() {
  const { state } = useCompany();
  const [copied, setCopied] = useState(false);

  if (state.status === 'loading') return <p className="sx-muted">Loading your vault…</p>;
  if (state.status !== 'ready') {
    return (
      <div className="sx-notice sx-notice-error" role="alert">
        <p>{state.message}</p>
        <p>
          <Link href={state.status === 'signin' ? '/login' : '/dashboard/setup'}>{state.status === 'signin' ? 'Sign in' : 'Go to account setup'}</Link>
        </p>
      </div>
    );
  }
  const c = state.company;
  const vault = c.vault;
  if (!vault) {
    return (
      <section className="sx-card sx-stack">
        <h2>Set up this device and your vault</h2>
        <p className="sx-muted">Your company gets its own Squads vault on Solana. Its keys are made in your browser; Splash never sees them.</p>
        <div>
          <Link className="sx-btn" href="/dashboard/setup">
            Go to account setup
          </Link>
        </div>
      </section>
    );
  }
  const waiting = c.payments.filter((p) => p.awaitingApproval);
  const recent = c.payments.slice(0, 5);
  const empty = BigInt(c.balance.totalMinor) === 0n;

  return (
    <div className="sx-stack-lg">
      <div className="sx-overview-top">
        <div className="sx-stack">
          <BalanceHeader balance={c.balance} simulated={c.simulated} />
          {c.treasury ? (
            <p className="sx-small">
              Treasury (operating cash): <strong className="sx-num">{usd(c.treasury.balanceMinor)}</strong>{' '}
              <Link href="/dashboard/treasury">{empty && BigInt(c.treasury.balanceMinor) > 0n ? 'Move to your payments vault' : 'Open treasury'}</Link>
            </p>
          ) : null}
          <div className="sx-row">
            <Link className="sx-btn" href="/dashboard/invoices">
              Pay an invoice
            </Link>
            <Link className="sx-btn sx-btn-ghost" href="/dashboard/transfer">
              Transfer
            </Link>
            <Link className="sx-btn sx-btn-ghost" href={empty ? '/dashboard/treasury' : '/dashboard/fund'}>
              {empty ? 'Fund your payments vault' : 'Balance and deposits'}
            </Link>
          </div>
        </div>

        <section className="sx-card sx-stack" aria-labelledby="vault-title">
          <h2 id="vault-title">Your vault</h2>
          <p className="sx-small sx-muted">One Squads multisig, two vaults: payments (#0) and treasury (#1).</p>
          <dl className="sx-kv">
            <dt>Address</dt>
            <dd>
              <span className="sx-mono" title={vault.vaultPda}>
                {shortKey(vault.vaultPda, 6)}
              </span>{' '}
              <button
                type="button"
                className="sx-btn-link sx-small"
                onClick={async () => {
                  setCopied(await copyText(vault.vaultPda));
                  setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
                <span className="sx-visually-hidden"> vault address</span>
              </button>
              {vault.solscanUrl ? (
                <>
                  {' '}
                  <a className="sx-small" href={vault.solscanUrl} target="_blank" rel="noreferrer">
                    View on Solscan<span className="sx-visually-hidden"> (opens in a new tab)</span>
                  </a>
                </>
              ) : null}
            </dd>
            <dt>Approvals</dt>
            <dd>
              {vault.threshold} of {vault.members.filter((m) => m.role !== 'recovery_kit_a' && m.role !== 'recovery_kit_b').length} device{vault.threshold === 1 ? '' : 's'}, plus your recovery kit
            </dd>
            <dt>Who can change it</dt>
            <dd>Nobody outside the vault, Splash included. Config authority: none</dd>
          </dl>
          {!c.me.canApprove ? (
            <p className="sx-small">
              This device is not an approver yet. <Link href="/dashboard/settings/devices">See devices</Link>
            </p>
          ) : null}
        </section>
      </div>

      <section aria-labelledby="waiting-title" className="sx-stack">
        <h2 id="waiting-title">Waiting for approval</h2>
        {waiting.length === 0 ? (
          <p className="sx-muted">Nothing is waiting. Payments you start appear here until a person approves them on a device.</p>
        ) : (
          <ul className="sx-verify">
            {waiting.map((p) => (
              <li key={p.id} className="sx-pay-row">
                <span>
                  <strong>{p.supplierName || 'Supplier'}</strong> <span className="sx-num">{php(p.amountPhpMinor)}</span>
                  <span className="sx-small sx-muted" style={{ display: 'block' }}>
                    {p.approvals.approved} of {p.approvals.threshold} approval{p.approvals.threshold === 1 ? '' : 's'}
                    {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ''}
                  </span>
                </span>
                <Link className="sx-btn" href={payHref(p)}>
                  Review and approve<span className="sx-visually-hidden"> the payment to {p.supplierName}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-title" className="sx-stack">
        <div className="sx-row" style={{ justifyContent: 'space-between' }}>
          <h2 id="recent-title">Recent payments</h2>
          {c.payments.length > 0 ? <Link href="/dashboard/history">All payments</Link> : null}
        </div>
        {recent.length === 0 ? (
          <p className="sx-muted">
            No payments yet. <Link href="/dashboard/invoices">Pay your first supplier invoice</Link>, or <Link href="/dashboard/transfer">make a transfer</Link>.
          </p>
        ) : (
          <ul className="sx-verify">
            {recent.map((p) => (
              <li key={p.id} className="sx-pay-row">
                <span>
                  <strong>{p.supplierName || 'Supplier'}</strong> <span className="sx-num">{php(p.amountPhpMinor)}</span>
                  <span className="sx-small sx-muted" style={{ display: 'block' }}>
                    {dateShort(p.createdAt)}
                    {p.youPayUsdcMinor ? ` · ${usd(p.youPayUsdcMinor)} from your vault` : ''}
                  </span>
                </span>
                <span className="sx-row">
                  <StatusPill state={p.state} label={p.stateLabel} />
                  {p.receiptId ? (
                    <Link href={`/dashboard/receipts/${p.receiptId}`}>
                      Receipt<span className="sx-visually-hidden"> for {p.supplierName}</span>
                    </Link>
                  ) : (
                    <Link href={payHref(p)}>
                      Open<span className="sx-visually-hidden"> the payment to {p.supplierName}</span>
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
