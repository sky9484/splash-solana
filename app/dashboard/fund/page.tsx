import { FundPanel } from '@/components/solana/FundPanel';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Balance · Splash' };

export default function FundPage() {
  return (
    <SolanaDashPage kicker="Money" title="Balance" description="Your payments vault: the USDC that pays suppliers. Fund it from your treasury or any Solana wallet; Splash never holds it.">
      <FundPanel />
    </SolanaDashPage>
  );
}
