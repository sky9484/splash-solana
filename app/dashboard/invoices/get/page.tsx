// iso-ui
import { Suspense } from 'react';

import { GetPaid } from '@/components/solana/invoices/GetPaid';

export const metadata = { title: 'Get paid · Splash' };

/**
 * Get paid (prompt 10 §6.3): requests and the composer. A business on Splash pays in the app; anyone
 * else pays from a link. `?request=` opens one request; it is read in the browser, so the page sits
 * under a Suspense boundary.
 */
export default function GetPaidPage() {
  return (
    <Suspense fallback={null}>
      <GetPaid />
    </Suspense>
  );
}
