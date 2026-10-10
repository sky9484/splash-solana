'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { copyText, shortKey } from './client';
import { useOrg } from './useOrg';

const NAV = [
  { href: '/solana', label: 'Overview', exact: true },
  { href: '/solana/onboarding', label: 'Vault' },
  { href: '/solana/fund', label: 'Balance' },
  { href: '/solana/pay', label: 'Pay a supplier' },
  { href: '/solana/policy', label: 'Rules' },
  { href: '/solana/zeke', label: 'Zeke' },
];

export function SolanaNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav className="sx-nav" aria-label="Solana demo">
      <div className="sx-nav-inner">
        {NAV.map((n) => {
          const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}>
              {n.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function ModeBadge({ mode }: { mode: 'offline' | 'devnet' }) {
  return mode === 'offline' ? (
    <span className="sx-pill sx-pill-sim" title="Offline: every chain call runs in the simulator. The same code runs on devnet.">
      Simulated · devnet-ready
    </span>
  ) : (
    <span className="sx-pill sx-pill-warn">Solana devnet</span>
  );
}

/** Identity bar: company, short vault address, Copy, and the walk-away kit. */
export function IdentityBar() {
  const { state } = useOrg();
  const [copied, setCopied] = useState(false);
  if (state.status !== 'ready') {
    return (
      <div className="sx-identity">
        <span>No company yet</span>
        <Link className="sx-btn sx-btn-ghost sx-btn-sm" href="/solana/onboarding">
          Set up a vault
        </Link>
      </div>
    );
  }
  const { org, vault } = state.org;
  return (
    <div className="sx-identity">
      <span aria-hidden="true">●</span>
      <strong>{org.companyName}</strong>
      {vault ? (
        <>
          <span className="sx-mono" title={vault.vaultPda}>
            {shortKey(vault.vaultPda)}
          </span>
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
          <Link className="sx-small" href="/solana/onboarding#walk-away-kit">
            Walk-away kit
          </Link>
        </>
      ) : (
        <Link className="sx-small" href="/solana/onboarding">
          Finish vault setup
        </Link>
      )}
    </div>
  );
}
