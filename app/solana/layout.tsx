import type { Metadata } from 'next';
import Link from 'next/link';

import { IdentityBar, ModeBadge, SolanaNav } from '@/components/solana/Shell';
import { readSolanaEnv } from '@/lib/solana/config';

import './solana.css';

export const metadata: Metadata = {
  title: 'Splash on Solana · Colosseum build',
  description: 'Pay suppliers in Southeast Asia from your own Squads vault, and keep one record per payment.',
};

export default function SolanaLayout({ children }: { children: React.ReactNode }) {
  const { mode } = readSolanaEnv();
  return (
    <div className="sx">
      <header className="sx-top">
        <div className="sx-top-inner">
          <Link href="/solana" className="sx-brand">
            Splash <small>on Solana</small>
          </Link>
          <span className="sx-mode">
            <ModeBadge mode={mode} />
          </span>
          <IdentityBar />
        </div>
      </header>
      <SolanaNav />
      <main className="sx-main" id="main">
        {children}
      </main>
    </div>
  );
}
