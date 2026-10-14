// iso-ui
import { Suspense } from 'react';

import { TransferFlow } from '@/components/solana/transfer/TransferFlow';

export const metadata = { title: 'Transfer · Splash' };

/**
 * Transfer (prompt 10 Phase 3): Recipient, Amount, Quote & send, Approve, Track, to a bank account in
 * the Philippines or to another business on Splash. The step lives in the URL
 * (`?to=bank|splash&step=…&payment=…`), read in the browser, so the flow sits under a Suspense boundary.
 */
export default function TransferPage() {
  return (
    <Suspense fallback={null}>
      <TransferFlow />
    </Suspense>
  );
}
