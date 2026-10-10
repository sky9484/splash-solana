'use client';

import Link from 'next/link';
import { useState } from 'react';

import { BalanceHeader } from './BalanceHeader';
import { api, copyText, notifyOrgChanged, shortKey, timeShort, usd } from './client';
import { useOrg } from './useOrg';

export function FundPanel() {
  const { state, reload } = useOrg();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (state.status === 'loading') return <p className="sx-muted">Loading…</p>;
  if (state.status !== 'ready' || !state.org.vault) {
    return (
      <div className="sx-narrow sx-stack">
        <h1>Balance</h1>
        <p className="sx-lede">{state.status === 'reset' ? state.message : 'Set up your vault first. It takes about a minute.'}</p>
        <Link className="sx-btn" href="/solana/onboarding">
          Set up a vault
        </Link>
      </div>
    );
  }
  const org = state.org;
  const vault = org.vault!;
  const offline = org.mode === 'offline';

  async function addTestUsdc() {
    setBusy(true);
    setError(null);
    try {
      await api('/fund', { body: { orgId: org.org.id } });
      notifyOrgChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sx-stack-lg">
      <div>
        <h1>Balance</h1>
        <p className="sx-lede">USDC in your own Squads vault on Solana. Splash never holds the money.</p>
      </div>
      <BalanceHeader balance={org.balance} simulated={org.simulated} />

      <section className="sx-card sx-stack" aria-labelledby="add-title">
        <h2 id="add-title">Add USDC</h2>
        <dl className="sx-kv">
          <dt>Vault address</dt>
          <dd>
            <span className="sx-mono">{vault.vaultPda}</span>{' '}
            <button type="button" className="sx-btn-link sx-small" onClick={async () => setCopied(await copyText(vault.vaultPda))}>
              {copied ? 'Copied' : 'Copy'}
            </button>
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
                <Link className="sx-btn sx-btn-ghost" href="/solana/pay">
                  Pay a supplier
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
