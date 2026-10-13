import { SolanaDashPage } from '@/components/solana/SolanaDashPage';
import { TransferFlow } from '@/components/solana/transfer/TransferFlow';

export const metadata = { title: 'Transfer · Splash' };

const PAYMENT = /^pay_[0-9a-f]{16}$/;

/**
 * Transfer (Sky, 13 Oct): a payment with no invoice, in the five steps of the earlier "Send a payout"
 * flow: Beneficiary, Delivery, Quote & Send, Status, Receipt. Step 3 asks what the payout partner
 * needs, then pays from the company's own vaults or brings USD or a stablecoin in first, and ends with
 * one approval on this device. `?payment=` opens a transfer where it stands.
 */
export default async function TransferPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const payment = typeof sp.payment === 'string' && PAYMENT.test(sp.payment) ? sp.payment : null;
  return (
    <SolanaDashPage kicker="Payments" title="Transfer" wide bare>
      <TransferFlow resumePaymentId={payment} />
    </SolanaDashPage>
  );
}
