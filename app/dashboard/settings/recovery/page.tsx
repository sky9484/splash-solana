import { RecoveryPanel } from '@/components/solana/RecoveryPanel';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Recovery kit · Splash' };

export default function RecoveryPage() {
  return (
    <SolanaDashPage kicker="Settings" title="Recovery kit" description="Your way back into your accounts if a device is lost. Splash never sees it.">
      <RecoveryPanel />
    </SolanaDashPage>
  );
}
