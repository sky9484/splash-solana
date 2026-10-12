import { DevicesPanel } from '@/components/solana/DevicesPanel';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Devices · Splash' };

export default function DevicesPage() {
  return (
    <SolanaDashPage kicker="Settings" title="Devices" description="The keys that can approve a payment from your vault, as they are on Solana.">
      <DevicesPanel />
    </SolanaDashPage>
  );
}
