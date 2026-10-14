/**
 * "Save as template" (prompt 10 §5.8): a paid transfer, kept as a starting point for the next one.
 * A template holds who (a saved bank recipient by id, or a business on Splash) and how much, plus the
 * answers the payout partner asked for. Never a bank account number: that stays sealed in the vault
 * (Phase S), and a template to a recipient who is later removed, or whose bank details change, starts
 * over at the call-back like any other payment.
 *
 * Starting from a template opens Step 2 with everything filled in: the amount is quoted again, the
 * rules run again and a person approves again. A template moves nothing by itself.
 */
import { ServiceError } from './errors.ts';
import { recipientKey } from './transfer-details.ts';
import { getInvoice, getOrg, getPayment } from './service.ts';
import type { TransferTemplate } from './store.ts';

const MAX_TEMPLATES = 50;

function newTemplateId(): string {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return `tpl_${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function listTemplates(orgId: string): TransferTemplate[] {
  return [...(getOrg(orgId).transferTemplates ?? [])].reverse();
}

/** Keep a sent transfer as a template. The same recipient and amount twice is one template. */
export async function saveTemplate(orgId: string, paymentId: string, by: string, now = new Date()): Promise<TransferTemplate> {
  const p = await getPayment(paymentId);
  if (p.orgId !== orgId) throw new ServiceError('payment_not_found', 'That payment is not on the server for this company.', 404);
  const org = getOrg(orgId);
  const inv = getInvoice(orgId, p.invoiceId);
  const c = inv.confirmed;
  if (!c) throw new ServiceError('bad_request', 'Only a confirmed payment can be kept as a template.');
  let t: TransferTemplate;
  if (p.kind === 'peer') {
    const peer = inv.peer;
    if (!peer) throw new ServiceError('bad_request', 'This payment has no business on Splash to pay again.');
    t = {
      id: newTemplateId(),
      to: 'splash',
      recipientId: null,
      payee: { orgId: peer.payeeOrgId, name: peer.payeeName, handle: peer.payeeHandle, country: peer.payeeCountry },
      payeeName: peer.payeeName,
      amountPhpMinor: null,
      amountUsdMinor: peer.amountUsdMinor,
      purpose: null,
      description: null,
      relationship: null,
      sourceOfFunds: null,
      note: peer.note,
      createdAt: now.toISOString(),
      createdBy: by,
    };
  } else {
    const key = recipientKey(c);
    const saved = org.suppliers.find((s) => recipientKey({ supplierName: s.name, supplierBank: s.bank, supplierAccountLast4: s.accountLast4 }) === key);
    if (!saved) throw new ServiceError('bad_request', `${c.supplierName} isn’t on your saved recipients, so there is nothing to pay again from. Save them first.`, 409);
    const d = inv.paymentDetails ?? null;
    t = {
      id: newTemplateId(),
      to: 'bank',
      recipientId: saved.id,
      payee: null,
      payeeName: saved.name,
      amountPhpMinor: c.amountPhpMinor,
      amountUsdMinor: null,
      purpose: d?.purpose ?? null,
      description: d?.description ?? null,
      relationship: d?.relationship ?? null,
      sourceOfFunds: d?.sourceOfFunds ?? null,
      note: null,
      createdAt: now.toISOString(),
      createdBy: by,
    };
  }
  const list = (org.transferTemplates ??= []);
  const same = list.find((x) => x.to === t.to && x.recipientId === t.recipientId && (x.payee?.orgId ?? null) === (t.payee?.orgId ?? null) && x.amountPhpMinor === t.amountPhpMinor && x.amountUsdMinor === t.amountUsdMinor);
  if (same) return same;
  list.push(t);
  if (list.length > MAX_TEMPLATES) list.splice(0, list.length - MAX_TEMPLATES);
  return t;
}

export function deleteTemplate(orgId: string, id: string): void {
  const org = getOrg(orgId);
  const before = org.transferTemplates?.length ?? 0;
  org.transferTemplates = (org.transferTemplates ?? []).filter((t) => t.id !== id);
  if (org.transferTemplates.length === before) throw new ServiceError('bad_request', 'That template is already gone.', 404);
}
