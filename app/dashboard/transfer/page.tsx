import { PayFlow } from '@/components/solana/PayFlow';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Transfer · Splash' };

const PAYMENT = /^pay_[0-9a-f]{16}$/;
const INVOICE = /^inv_[0-9a-f]{16}$/;

/**
 * Transfer (Sky, 13 Oct): a payment with no invoice. The person types who and how much; from there it
 * is the same path as an invoice: routes, the rules, one approval on this device, the proof. It is paid
 * from the payments vault, which is funded first if it cannot cover it. `?payment=` opens a payment
 * where it stands; `?quote=` quotes the same transfer again after funding.
 */
export default async function TransferPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const payment = typeof sp.payment === 'string' && PAYMENT.test(sp.payment) ? sp.payment : null;
  const quote = typeof sp.quote === 'string' && INVOICE.test(sp.quote) ? sp.quote : null;
  return (
    <SolanaDashPage kicker="Payments" title="Transfer" description="Send pesos to a bank account with no invoice. Paid from your payments vault; a person approves on this device.">
      <PayFlow mode="transfer" resumePaymentId={payment} quoteInvoiceId={quote} />
    </SolanaDashPage>
  );
}
