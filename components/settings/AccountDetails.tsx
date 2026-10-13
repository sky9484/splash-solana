// iso-ui
// copy: technical
'use client';

import { useState } from 'react';

import { IsoSurface, Tag } from '@/components/iso';
import { useCompany } from '@/components/solana/useCompany';

import { DirectoryCard } from './DirectoryCard';

/**
 * Settings › Account details, the one place the dashboard shows account IDs and how approval is set
 * up (prompt 10 §0.6: the allowed zone for these words). The IDs moved here from the sidebar.
 */
export function AccountDetails() {
  const { state } = useCompany();

  if (state.status !== 'ready') {
    return (
      <div className="iso iso-page">
        <h1 className="iso-title">Account details</h1>
        <p className="iso-context">{state.status === 'loading' ? 'Loading your account…' : 'message' in state ? state.message : ''}</p>
      </div>
    );
  }
  const c = state.company;
  const network = c.mode === 'offline' ? 'Offline simulator (on no network)' : c.cluster === 'mainnet-beta' ? 'Solana mainnet' : 'Solana devnet';
  return (
    <div className="iso iso-page">
      <header className="iso-pagehead">
        <div>
          <h1 className="iso-title">Account details</h1>
          <p className="iso-context">The IDs of your company&rsquo;s own accounts, and who can approve a payment from them. Splash holds no key to either.</p>
        </div>
      </header>

      {c.vault ? (
        <IsoSurface aria-labelledby="acct-ids">
          <h2 id="acct-ids" className="iso-h2" style={{ marginBottom: 14 }}>
            Account IDs
          </h2>
          <dl className="iso-dl" style={{ gridTemplateColumns: 'minmax(0, 14rem) minmax(0, 1fr)' }}>
            <dt>Network</dt>
            <dd style={{ textAlign: 'left' }}>{network}</dd>
            <dt>Payments account ID</dt>
            <dd style={{ textAlign: 'left' }}>
              <CopyId value={c.vault.vaultPda} label="Payments account ID" href={c.vault.solscanUrl} />
            </dd>
            <dt>Its US dollar (USDC) token account</dt>
            <dd style={{ textAlign: 'left' }}>
              <CopyId value={c.vault.usdcTokenAccount} label="USDC token account" />
            </dd>
            {c.treasury ? (
              <>
                <dt>Reserve account ID</dt>
                <dd style={{ textAlign: 'left' }}>
                  <CopyId value={c.treasury.vaultPda} label="Reserve account ID" href={c.treasury.solscanUrl} />
                </dd>
              </>
            ) : null}
            <dt>Multisig (Squads)</dt>
            <dd style={{ textAlign: 'left' }}>
              <CopyId value={c.vault.multisigPda} label="Multisig ID" />
            </dd>
          </dl>
        </IsoSurface>
      ) : (
        <IsoSurface>
          <p className="iso-body">Your accounts are made in Account setup. Once they exist, their IDs are here.</p>
        </IsoSurface>
      )}

      {c.vault ? (
        <IsoSurface aria-labelledby="acct-approval">
          <h2 id="acct-approval" className="iso-h2" style={{ marginBottom: 14 }}>
            Approval setup
          </h2>
          <dl className="iso-dl" style={{ gridTemplateColumns: 'minmax(0, 14rem) minmax(0, 1fr)' }}>
            <dt>Approvals needed</dt>
            <dd style={{ textAlign: 'left' }}>
              {c.vault.threshold} of {c.vault.members.length} keys
            </dd>
            <dt>Keys</dt>
            <dd style={{ textAlign: 'left' }}>
              <ul className="iso-list" style={{ margin: 0 }}>
                {c.vault.members.map((m) => (
                  <li key={m.publicKey} style={{ padding: '6px 0', border: 0 }}>
                    <span>
                      {m.role === 'admin_device' ? 'This device (owner)' : m.role === 'approver_device' ? 'An approver’s device' : 'Your recovery kit'} ·{' '}
                      <span className="iso-mono">{m.publicKey.slice(0, 6)}…{m.publicKey.slice(-6)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
            <dt>Who can change the keys</dt>
            <dd style={{ textAlign: 'left' }}>
              <Tag tone="ok" tick>
                Only your own keys
              </Tag>{' '}
              <span className="iso-small">Config authority: none. Nobody outside the vault, Splash included.</span>
            </dd>
          </dl>
        </IsoSurface>
      ) : null}

      <DirectoryCard isOwner={c.me.isOwner} />
    </div>
  );
}

function CopyId({ value, label, href }: { value: string; label: string; href?: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="iso-row" style={{ gap: '4px 12px' }}>
      <span className="iso-mono" style={{ wordBreak: 'break-all', fontWeight: 600 }}>
        {value}
      </span>
      <button
        type="button"
        className="iso-btn iso-btn--link"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
        <span className="iso-sr"> {label}</span>
      </button>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="iso-btn iso-btn--link">
          Solscan<span className="iso-sr"> page for the {label} (opens in a new tab)</span>
        </a>
      ) : null}
    </span>
  );
}
