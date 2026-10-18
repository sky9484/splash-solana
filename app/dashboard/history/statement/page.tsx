import Link from 'next/link';
import { Suspense } from 'react';

import { StatementView } from '@/components/solana/receipt/StatementView';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Monthly statement · Splash' };

/** One month of one account, printable (prompt 12 §5.5): ?month=YYYY-MM&account=payments|treasury|all. */
export default function StatementPage() {
  return (
    <SolanaDashPage
      kicker="Money"
      title="Monthly statement"
      description="One month of one account, from your records, every line with its receipt."
      actions={
        <Link href="/dashboard/history" className="dash-btn-ghost !px-4 !py-2 !text-[13px]">
          History
        </Link>
      }
      wide
    >
      {/* The statement reads ?month= and ?account=. */}
      <Suspense fallback={<p className="sx-muted">Loading the statement…</p>}>
        <StatementView />
      </Suspense>
    </SolanaDashPage>
  );
}
