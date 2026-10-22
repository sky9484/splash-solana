import { PageHead } from '@/components/dashboard/PageHead';
import { DevicesPanel } from '@/components/solana/DevicesPanel';

export const metadata = { title: 'Devices · Splash' };

export default function DevicesPage() {
  return (
    <div className="iso iso-page">
      <PageHead title="Devices" context="The keys that can approve a payment from your accounts, as they are recorded." />
      <DevicesPanel />
    </div>
  );
}
