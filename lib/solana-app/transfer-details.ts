/**
 * What the payout partner needs with a transfer, asked in Step 3 (Sky, 13 Oct).
 *
 * Every transfer: why the money is sent (purchase of goods or of services, and what was bought),
 * where it comes from, and the sender's relationship to the recipient. The Philippines requires a
 * purpose on inbound payments (BSP), and partner banks ask the source of funds and the relationship
 * on cross-border business payments (lib/compliance/travel-rule.ts holds the corridor rules).
 *
 * The first transfer to a recipient also asks who they are: business or individual, a registration
 * number (business) or a date of birth or ID number (individual), their address, and the account
 * holder's name as the bank has it. The next transfer to the same recipient asks one question,
 * "Same details as before?": yes copies them, no asks every question again.
 *
 * The answers are frozen on the transfer they were given for: details edited later never rewrite a
 * payment already sent (the travel rule is about what accompanied THIS payment).
 */
import { ServiceError } from './errors.ts';
import { isCommitted } from './payment-machine.ts';
import { runtime } from './runtime.ts';
import { SOURCE_OF_FUNDS } from './source-of-funds.ts';
import { getInvoice, getOrg } from './service.ts';
import type { InvoiceRecord, OrgRecord, TransferDetails } from './store.ts';

export const PURPOSES: Record<TransferDetails['purpose'], string> = {
  goods: 'Purchase of goods',
  services: 'Purchase of services',
};

export const RELATIONSHIPS: Record<TransferDetails['relationship'], string> = {
  supplier: 'Supplier, not related to us',
  related_company: 'A company in our group',
  contractor: 'Contractor or freelancer',
};

export type DetailsInput = Omit<TransferDetails, 'reused' | 'givenBy' | 'givenAt'>;

/** One recipient, however its name is spaced or cased. */
export function recipientKey(c: { supplierName: string; supplierBank: string; supplierAccountLast4: string }): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return `${norm(c.supplierName)}|${norm(c.supplierBank)}|${c.supplierAccountLast4.trim()}`;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** What is still missing, in the words the form uses. Empty when the partner has what it needs. */
export function missingDetails(d: Partial<DetailsInput> | null | undefined): string[] {
  const out: string[] = [];
  if (!d) return ['Purpose of payment'];
  if (!d.purpose || !PURPOSES[d.purpose]) out.push('Purpose of payment');
  if (text(d.description).length < 3) out.push('What was bought');
  if (!d.relationship || !RELATIONSHIPS[d.relationship]) out.push('Your relationship to the recipient');
  if (!d.sourceOfFunds || !SOURCE_OF_FUNDS[d.sourceOfFunds]) out.push('Where the money comes from');
  const r = d.recipient;
  if (!r || (r.type !== 'business' && r.type !== 'individual')) out.push('Business or individual');
  if (r?.type === 'business' && text(r.registrationNumber).length < 3) out.push('Company registration number');
  if (r?.type === 'individual' && text(r.idNumber).length < 3 && !/^\d{4}-\d{2}-\d{2}$/.test(text(r.dateOfBirth))) out.push('Date of birth or ID number');
  if (!r || text(r.addressLine1).length < 3 || text(r.addressCity).length < 2) out.push('Recipient address');
  if (!r || text(r.accountName).length < 2) out.push('Account holder name');
  return out;
}

function transferOf(orgId: string, invoiceId: string): InvoiceRecord {
  const inv = getInvoice(orgId, invoiceId);
  if (inv.source !== 'transfer' || !inv.confirmed) throw new ServiceError('bad_request', 'Only a transfer takes these details.');
  return inv;
}

function savedFor(org: OrgRecord, inv: InvoiceRecord): TransferDetails | null {
  return org.recipientDetails?.[recipientKey(inv.confirmed!)] ?? null;
}

/** The details last given for this transfer's recipient, if any: what "Same details as before?" offers. */
export function previousDetails(orgId: string, invoiceId: string): TransferDetails | null {
  const inv = transferOf(orgId, invoiceId);
  return savedFor(getOrg(orgId), inv);
}

/**
 * The answers went with the payment once it was sent: they are part of its record and can no longer
 * change (and a discarded transfer takes no new answers). Checked before every change.
 */
export async function assertDetailsEditable(orgId: string, invoiceId: string): Promise<void> {
  transferOf(orgId, invoiceId);
  const payments = (await runtime().payments.listByOrg(orgId)).filter((p) => p.invoiceId === invoiceId);
  if (payments.some((p) => isCommitted(p.state))) {
    throw new ServiceError('wrong_state', 'This transfer has been sent. The details that went with it are part of its record and can no longer change.', 409);
  }
  if (payments.length > 0 && payments.every((p) => p.state === 'discarded')) {
    throw new ServiceError('wrong_state', 'This transfer was discarded. Start a new transfer to give its details.', 409);
  }
}

/** Record the answers for this transfer, either the same as last time or given again in full. */
export function setTransferDetails(orgId: string, invoiceId: string, input: { reuse: true } | { details: DetailsInput }, by: string, now = new Date()): TransferDetails {
  const org = getOrg(orgId);
  const inv = transferOf(orgId, invoiceId);
  let details: TransferDetails;
  if ('reuse' in input) {
    const prev = savedFor(org, inv);
    if (!prev) throw new ServiceError('bad_request', 'There are no earlier details for this recipient. Answer the questions instead.', 409);
    details = { ...prev, recipient: { ...prev.recipient }, reused: true, givenBy: by, givenAt: now.toISOString() };
  } else {
    const d = input.details;
    const missing = missingDetails(d);
    if (missing.length) throw new ServiceError('bad_request', `Still needed for the payout partner: ${missing.join(', ')}.`, 422, { missing });
    const r = d.recipient;
    details = {
      purpose: d.purpose,
      description: text(d.description),
      relationship: d.relationship,
      sourceOfFunds: d.sourceOfFunds,
      recipient: {
        type: r.type,
        registrationNumber: r.type === 'business' ? text(r.registrationNumber) : null,
        idNumber: r.type === 'individual' ? text(r.idNumber) || null : null,
        dateOfBirth: r.type === 'individual' ? text(r.dateOfBirth) || null : null,
        addressLine1: text(r.addressLine1),
        addressCity: text(r.addressCity),
        addressCountry: 'PH',
        accountName: text(r.accountName),
      },
      reused: false,
      givenBy: by,
      givenAt: now.toISOString(),
    };
  }
  inv.paymentDetails = details;
  org.recipientDetails ??= {};
  org.recipientDetails[recipientKey(inv.confirmed!)] = details;
  return details;
}

/** One line for the approval card and the receipt: "Purchase of services: sea freight, October". */
export function purposeLine(d: TransferDetails | null | undefined): string | null {
  return d ? `${PURPOSES[d.purpose]}: ${d.description}` : null;
}

export function detailsView(d: TransferDetails | null | undefined) {
  if (!d) return null;
  return {
    ...d,
    purposeLabel: PURPOSES[d.purpose],
    relationshipLabel: RELATIONSHIPS[d.relationship],
    sourceOfFundsLabel: SOURCE_OF_FUNDS[d.sourceOfFunds],
  };
}

export const DETAILS_OPTIONS = {
  purposes: Object.entries(PURPOSES).map(([value, label]) => ({ value, label })),
  relationships: Object.entries(RELATIONSHIPS).map(([value, label]) => ({ value, label })),
  sourcesOfFunds: Object.entries(SOURCE_OF_FUNDS).map(([value, label]) => ({ value, label })),
};
