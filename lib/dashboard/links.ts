/**
 * Where "Pay an invoice" and "Get paid" go, in one place (prompt 10 §6.1). The sidebar's Invoices
 * item opens the chooser at `/dashboard/invoices`; links from elsewhere (Overview, Balance, a
 * notification) go straight to the sub-route. `tests/solana-overview.test.mjs` checks that every link
 * on the Overview resolves to a page.
 */
export const INVOICE_LINKS: { pay: string; get: string | null } = {
  pay: '/dashboard/invoices/pay',
  get: '/dashboard/invoices/get',
};

/** One bill to check, by its id: Pay an invoice opens "Check the invoice" on it. */
export const billHref = (invoiceId: string) => `/dashboard/invoices/pay?invoice=${invoiceId}`;

/** One payment request, by its id: Get paid opens it. */
export const requestHref = (requestId: string) => `/dashboard/invoices/get?request=${requestId}`;
