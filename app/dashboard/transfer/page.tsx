import { PayFlow } from '@/components/solana/PayFlow';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Pay a supplier · Splash' };

/**
 * Pay a supplier on Solana (prompt 07 §5): invoice → Zeke's draft, checked by a person → routes →
 * approve on this device → progress → receipt. `?payment=` opens a payment where it stands.
 */
export default async function TransferPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const payment = typeof sp.payment === 'string' && /^pay_[0-9a-f]{16}$/.test(sp.payment) ? sp.payment : null;
  return (
    <SolanaDashPage kicker="Payments" title="Pay a supplier" description="Zeke drafts from the invoice. A person checks every field and approves on this device.">
      <PayFlow resumePaymentId={payment} />
    </SolanaDashPage>
  );
}
