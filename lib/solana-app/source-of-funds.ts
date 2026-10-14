/**
 * Where the money for a payment comes from: asked once in a transfer's Step 3 ("About this payment")
 * and named again in the declaration when money is brought in from outside the vaults.
 *
 * A leaf module with no imports, on purpose: the funding service and the transfer details both read
 * it, and they import each other's neighbours, so a shared constant must not sit inside that cycle.
 */
export type SourceOfFunds = 'business_revenue' | 'owner_capital' | 'loan_or_facility' | 'customer_payment';

export const SOURCE_OF_FUNDS: Record<SourceOfFunds, string> = {
  business_revenue: 'Business revenue',
  owner_capital: 'Owner’s capital',
  loan_or_facility: 'A loan or credit facility',
  customer_payment: 'A customer’s payment',
};
