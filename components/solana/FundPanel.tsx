'use client';

import Link from 'next/link';
import { useState } from 'react';

import { BalanceHeader } from './BalanceHeader';
import { api, copyText, shortKey, timeShort, usd } from './client';
import { notifyCompanyChanged, useCompany } from './useCompany';

export function FundPanel() {
  const { state, reload } = useCompany();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (state.status === 'loading') return <p className="sx-muted">Loading your vault…</p>;
  if (state.status !== 'ready' || !state.company.vault) {
    return (
      <div className="sx-narrow sx-stack">
        <p className="sx-lede">{state.status === 'ready' ? 'Set up this device and your vault first. It takes about a minute.' : state.message}</p>
        <Link className="sx-btn" href={state.status === 'signin' ? '/login' : '/dashboard/setup'}>
          {state.status === 'signin' ? 'Sign in' : 'Set up this device'}
        </Link>
      </div>
    );
  }
  const org = state.company;
  const vault = org.vault!;
  const offline = org.mode === 'offline';

  async function addTestUsdc() {
    setBusy(true);
    setError(null);
    try {
      await api('/fund', { body: {} });
      notifyCompanyChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sx-stack-lg">
      <BalanceHeader balance={org.balance} simulated={org.simulated} />

      {org.treasury ? (
        <section className="sx-card-quiet sx-row" aria-labelledby="from-treasury-title" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 id="from-treasury-title" style={{ fontSize: 16 }}>
              From your treasury
            </h2>
            <p className="sx-small">
              Your operating cash holds <strong className="sx-num">{usd(org.treasury.balanceMinor)}</strong>. Move it here with one approval on this device; no Splash fee.
            </p>
          </div>
          <Link className="sx-btn sx-btn-sm" href="/dashboard/treasury">
            Move from treasury
          </Link>
        </section>
      ) : null}

      <section className="sx-card sx-stack" aria-labelledby="add-title">
        <h2 id="add-title">Add USDC</h2>
        <dl className="sx-kv">
          <dt>Vault address</dt>
          <dd>
            <span className="sx-mono">{vault.vaultPda}</span>{' '}
            <button type="button" className="sx-btn-link sx-small" onClick={async () => setCopied(await copyText(vault.vaultPda))}>
              {copied ? 'Copied' : 'Copy'}
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
          <dt>USDC account</dt>
          <dd>
            <span className="sx-mono">{vault.usdcTokenAccount}</span>
          </dd>
        </dl>
        {offline ? (
          <>
            <p className="sx-muted">Offline, the simulator plays the faucet. Nothing touches a network.</p>
            {error ? (
              <div className="sx-notice sx-notice-error" role="alert">
                <p>{error}</p>
              </div>
            ) : null}
            <div className="sx-row">
              <button type="button" className="sx-btn" onClick={addTestUsdc} disabled={busy}>
                {busy ? 'Adding…' : 'Add 25,000 test USDC (simulated)'}
              </button>
              {BigInt(org.balance.totalMinor) > 0n ? (
                <Link className="sx-btn sx-btn-ghost" href="/dashboard/invoices">
                  Pay an invoice
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <ol className="sx-mock-list">
            <li>Copy the vault address above.</li>
            <li>
              Open the{' '}
              <a href={org.faucetUrl ?? 'https://faucet.circle.com/'} target="_blank" rel="noreferrer">
                Circle faucet
              </a>
              , choose Solana Devnet and USDC, and paste the vault address.
            </li>
            <li>
              Come back and{' '}
              <button type="button" className="sx-btn-link" onClick={() => void reload()}>
                refresh the balance
              </button>
              .
            </li>
          </ol>
        )}
      </section>

      {org.fundings.length > 0 ? (
        <section className="sx-card" aria-labelledby="history-title">
          <h2 id="history-title">Added</h2>
          <ul className="sx-verify" style={{ marginTop: 8 }}>
            {org.fundings.map((f, i) => (
              <li key={i} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <span>
                  {f.note} <span className="sx-hash">{shortKey(f.signature, 6)}</span>
                </span>
                <span className="sx-num">
                  {usd(f.amountMinor)} <span className="sx-muted sx-small">{timeShort(f.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
