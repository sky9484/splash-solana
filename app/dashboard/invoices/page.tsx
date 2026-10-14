// iso-ui
import { redirect } from 'next/navigation';

import { InvoicesChooser } from '@/components/solana/invoices/InvoicesChooser';

export const metadata = { title: 'Invoices · Splash' };

const PAYMENT = /^pay_[0-9a-f]{16}$/;
const INVOICE = /^inv_[0-9a-f]{16}$/;

/**
 * Invoices (prompt 10 §6.1): only the choice, Get paid or Pay an invoice. The sidebar always opens it.
 * `?mode=pay|get` only redirects to the sub-route; links made before the split still land somewhere
 * real: `?payment=` opens the payment on Transfer (one engine, one approval card), `?invoice=` and
 * `?quote=` open the bill on Pay an invoice.
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : null);
  const mode = one('mode');
  if (mode === 'pay') redirect('/dashboard/invoices/pay');
  if (mode === 'get') redirect('/dashboard/invoices/get');
  const payment = one('payment');
  if (payment && PAYMENT.test(payment)) redirect(`/dashboard/transfer?payment=${payment}`);
  const bill = one('invoice') ?? one('quote');
  if (bill && INVOICE.test(bill)) redirect(`/dashboard/invoices/pay?invoice=${bill}`);
  return <InvoicesChooser />;
}
