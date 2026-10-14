import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ReceiptView } from '@/components/solana/ReceiptView';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Receipt · Splash' };

/**
 * A receipt with its five checks, its Solscan trace and "Share with auditor": for a payment, money
 * received against a request, or a treasury order, so the heading names none of them in particular.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^rcpt_[0-9a-f]{16}$/.test(id)) notFound();
  return (
    <SolanaDashPage
      kicker="Receipt"
      title="One record, checked in your browser"
      description="What moved, who approved it and the proof recorded for it. Your browser checks the record; the server only supplies it."
      actions={
        <Link href="/dashboard/history" className="dash-btn-ghost !px-4 !py-2 !text-[13px]">
          History
        </Link>
      }
    >
      <ReceiptView source={{ kind: 'company', id }} />
    </SolanaDashPage>
  );
}
