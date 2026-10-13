import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ReceiptView } from '@/components/solana/ReceiptView';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Receipt · Splash' };

/** A receipt with its five checks, its Solscan trace and "Share with auditor". */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^rcpt_[0-9a-f]{16}$/.test(id)) notFound();
  return (
    <SolanaDashPage
      kicker="Receipt"
      title="One record for this payment"
      description="The confirmed invoice, the approval, the transfer, the partner’s report and the rate, checked in your browser."
      actions={
        <Link href="/dashboard/history" className="dash-btn-ghost !px-4 !py-2 !text-[13px]">
          All payments
        </Link>
      }
    >
      <ReceiptView source={{ kind: 'company', id }} />
    </SolanaDashPage>
  );
}
