'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * The sidebar's foot (prompt 07 §6.2): which network this is, and this company's vault on it,
 * shortened, with copy and its Solscan page. Offline there is no network to link to, and it says so.
 */
export default function SolanaRail({ mode, cluster, vault }: { mode: 'offline' | 'devnet'; cluster: 'devnet' | 'mainnet-beta'; vault: { address: string; solscanUrl: string | null } | null }) {
  const [copied, setCopied] = useState(false);
  const network = cluster === 'mainnet-beta' ? 'Solana' : 'Solana devnet';
  const short = vault ? `${vault.address.slice(0, 4)}…${vault.address.slice(-4)}` : null;

  return (
    <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.07] p-3 text-white">
      <p className="text-[12px] font-semibold uppercase tracking-widest text-white">
        {network}
        {mode === 'offline' ? ' · simulated' : ''}
      </p>
      {vault ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span className="font-mono" title={vault.address}>
            <span className="sr-only">Your vault: </span>
            {short}
          </span>
          <button
            type="button"
            className="min-h-[32px] font-semibold text-white underline underline-offset-2 hover:text-[#bfe6ee]"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(vault.address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied' : 'Copy'}
            <span className="sr-only"> vault address</span>
          </button>
          {vault.solscanUrl ? (
            <a href={vault.solscanUrl} target="_blank" rel="noreferrer" className="min-h-[32px] font-semibold text-white underline underline-offset-2 hover:text-[#bfe6ee]">
              Solscan<span className="sr-only"> page for your vault (opens in a new tab)</span>
            </a>
          ) : (
            <span className="text-white">Not on a network</span>
          )}
        </div>
      ) : (
        <Link href="/dashboard/setup" className="mt-2 inline-block text-[13px] font-semibold text-white underline underline-offset-2">
          No vault yet. Set one up
        </Link>
      )}
    </div>
  );
}
