// iso-ui
import { Suspense } from 'react';

import { PayInvoices } from '@/components/solana/invoices/PayInvoices';

export const metadata = { title: 'Pay an invoice · Splash' };

/**
 * Pay an invoice (prompt 10 §6.2): drop an invoice, Zeke reads it, a person checks it, then the payment
 * opens on Transfer's Step 3. `?invoice=` opens Check the invoice on one bill; it is read in the
 * browser, so the page sits under a Suspense boundary.
 */
export default function PayInvoicePage() {
  return (
    <Suspense fallback={null}>
      <PayInvoices />
    </Suspense>
  );
}
