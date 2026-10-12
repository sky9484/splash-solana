import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import MoneyPathPanel from '@/components/compliance/MoneyPathPanel';

/**
 * Treasury is not part of the Solana build.
 *
 * Money sits in the business's own Squads vault; Splash runs no treasury
 * product on this build, so this page shows no balances, no rates and no
 * projections. It keeps the dashboard frame so the nav entry lands somewhere
 * honest instead of a 404.
 */
export default function TreasuryPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <span className="dash-kicker">Working capital</span>
        <h1 className="dash-title mt-2">Treasury</h1>
      </header>
      <section className="dash-block p-6">
        <h2 className="text-base font-semibold text-[#1F4452]">Not available on this build</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#326273]/90">
          Your USDC stays in your business&rsquo;s own vault on Solana, and a person on your team approves each payment
          from it with their device key. This build has no treasury feature, so there are no balances or rates to show
          here.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--info)] underline-offset-4 hover:underline"
        >
          <ArrowLeft size={14} aria-hidden="true" /> Back to the dashboard
        </Link>
      </section>
      <MoneyPathPanel />
    </div>
  );
}
