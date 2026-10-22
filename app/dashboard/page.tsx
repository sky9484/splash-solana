import { Overview } from '@/components/solana/Overview';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Overview · Splash' };

/** The vault's balance, what is waiting for approval, and the last five payments (prompt 07 §6.2). */
export default function OverviewPage() {
  return (
    <SolanaDashPage kicker="Overview" title="Your vault on Solana" description="USDC in your company’s own Squads vault. Splash never holds the money.">
      <Overview />
    </SolanaDashPage>
  );
}
