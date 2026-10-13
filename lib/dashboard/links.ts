/**
 * Where "Pay an invoice" and "Get paid" go, in one place.
 *
 * Prompt 10 Phase 4 builds `/dashboard/invoices/pay` and `/dashboard/invoices/get` and points these at
 * them. Until then "Pay an invoice" opens Invoices as it is today, and "Get paid" isn't offered: a
 * button that leads to a missing page, or to the wrong one, is worse than no button.
 * `tests/solana-overview.test.mjs` checks that every link on the Overview resolves to a page.
 */
export const INVOICE_LINKS: { pay: string; get: string | null } = {
  pay: '/dashboard/invoices',
  get: null,
};
