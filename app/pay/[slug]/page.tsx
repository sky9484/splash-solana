import { notFound } from 'next/navigation';

import PayInvoiceClient from '@/components/pay/PayInvoiceClient';
import { PayLink } from '@/components/pay/PayLink';
import { toWire } from '@/lib/solana-app/json';
import { payLinkView } from '@/lib/solana-app/requests';
import { findInvoiceBySlug } from '@/lib/server/invoices-store';
import { payLinkBankInstructions } from '@/lib/server/pay-link';
import { stablecoinOnly } from '@/lib/server/launch-scope';
import { findIssuerForPayLink } from '@/lib/server/recipients-store';
import { publicUsdcForSlug } from '@/lib/server/usdc-invoice-payments';

export const dynamic = 'force-dynamic';

/** A Get paid link's token (lib/solana-app/requests.ts): 128 random bits, base64url. */
const REQUEST_SLUG = /^[A-Za-z0-9_-]{22}$/;

/**
 * A payment request's page. A request made in Get paid (prompt 10 §6.3) shows the requester's own
 * account and nothing else; opening it marks the request "Viewed" for the requester, except their own
 * look at it (`?preview=1`). Links made by the earlier invoices module still open their page.
 */
export default async function PayInvoicePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  if (REQUEST_SLUG.test(slug)) {
    const view = await payLinkView(slug, { markViewed: sp.preview !== '1' });
    if (view) return <PayLink slug={slug} view={toWire(view)} />;
  }

  const invoice = await findInvoiceBySlug(slug);
  if (!invoice) notFound();
  const issuer = await findIssuerForPayLink(invoice.orgId, invoice.issuerOrg);
  const reference = invoice.paymentReference ?? `SPL-${slug.toUpperCase()}-${invoice.id.slice(-4).toUpperCase()}`;
  const usdc = await publicUsdcForSlug(slug);

  return (
    <PayInvoiceClient
      slug={slug}
      invoice={{
        issuerOrg: invoice.issuerOrg,
        issuerVerified: issuer?.kybStatus === 'full',
        amountUsd: invoice.amountUsd,
        targetCurrency: invoice.targetCurrency,
        dueDate: invoice.dueDate,
        memo: invoice.memo,
        status: invoice.status,
        paymentReference: reference,
        bankInstructions: payLinkBankInstructions(),
        // A bank payment can be reported here only where Splash takes those
        // reports; a USDC-only launch matches USDC payments alone.
        bankReports: !stablecoinOnly(),
        usdc,
      }}
    />
  );
}
