import { PageHead } from '@/components/dashboard/PageHead';
import { RecoveryPanel } from '@/components/solana/RecoveryPanel';

export const metadata = { title: 'Recovery kit · Splash' };

export default function RecoveryPage() {
  return (
    <div className="iso iso-page">
      <PageHead title="Recovery kit" context="Your way back into your accounts if a device is lost. Splash never sees it." />
      <RecoveryPanel />
    </div>
  );
}
