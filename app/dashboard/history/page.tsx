import { Suspense } from 'react';

import { History } from '@/components/solana/History';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'History · Splash' };

/** Every payment and where it stands; transfers and history are one list (prompt 07 §6.2). */
export default function HistoryPage() {
  return (
    <SolanaDashPage kicker="Money" title="History" description="Every payment, where it stands, the transaction that moved the money, and its receipt." wide>
      {/* History reads ?station= (a link from Overview's pipeline). */}
      <Suspense fallback={<p className="sx-muted">Loading payments…</p>}>
        <History />
      </Suspense>
    </SolanaDashPage>
  );
}
