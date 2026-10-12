import { FundPanel } from '@/components/solana/FundPanel';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Balance · Splash' };

export default function FundPage() {
  return (
    <SolanaDashPage kicker="Money" title="Balance" description="USDC in your own Squads vault on Solana. Add to it from any Solana wallet; Splash never holds it.">
      <FundPanel />
    </SolanaDashPage>
  );
}
