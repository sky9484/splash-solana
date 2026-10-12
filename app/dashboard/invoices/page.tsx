import { PayFlow } from '@/components/solana/PayFlow';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Invoices · Splash' };

const PAYMENT = /^pay_[0-9a-f]{16}$/;
const INVOICE = /^inv_[0-9a-f]{16}$/;

/**
 * Invoices (Sky, 13 Oct): the supplier invoices the company pays, and the loop each one goes round:
 * Zeke reads it, a person checks every field, a person approves on a device, the payout partner pays
 * the bank, the proof is anchored on Solana. "Pay a supplier" and the earlier inspection loop are one
 * page now. `?payment=` opens a payment where it stands; `?quote=` quotes a confirmed invoice again
 * (after the payments vault was funded).
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const payment = typeof sp.payment === 'string' && PAYMENT.test(sp.payment) ? sp.payment : null;
  const quote = typeof sp.quote === 'string' && INVOICE.test(sp.quote) ? sp.quote : null;
  return (
    <SolanaDashPage kicker="Payments" title="Invoices" description="Zeke reads each supplier invoice. A person checks every field and approves on this device, and the proof is kept.">
      <PayFlow mode="invoice" resumePaymentId={payment} quoteInvoiceId={quote} />
    </SolanaDashPage>
  );
}
