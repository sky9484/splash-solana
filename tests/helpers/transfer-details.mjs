// The answers a person gives the payout partner in a transfer's Step 3, for tests that send a transfer.
import { setTransferDetails } from '../../lib/solana-app/transfer-details.ts';

export const SAMPLE_DETAILS = {
  purpose: 'goods',
  description: 'Corrugated cartons, October order',
  relationship: 'supplier',
  sourceOfFunds: 'business_revenue',
  recipient: {
    type: 'business',
    registrationNumber: 'CS201912345',
    idNumber: null,
    dateOfBirth: null,
    addressLine1: '88 Quimpo Boulevard',
    addressCity: 'Davao City',
    addressCountry: 'PH',
    accountName: 'Davao Packaging Corp.',
  },
};

/** Give the partner's details for a transfer, as a person would in Step 3. */
export function giveDetails(orgId, invoiceId, by = 'Aisyah') {
  return setTransferDetails(orgId, invoiceId, { details: SAMPLE_DETAILS }, by);
}
