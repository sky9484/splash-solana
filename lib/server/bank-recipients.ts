import { mayRevealBankNumbers, markBankDetailsVerified, saveBankNumber } from '@/lib/server/bank-details';
import { kmsFromEnv } from '@/lib/server/kms';
import { fingerprintOf, normaliseAccountNumber, VaultError } from '@/lib/server/pii-vault';
import { ServiceError } from '@/lib/solana-app/errors';
import { runtime } from '@/lib/solana-app/runtime';
import { getOrg } from '@/lib/solana-app/service';
import { newSupplierId, store, type OrgRecord, type SupplierRecord } from '@/lib/solana-app/store';
import { DETAILS_OPTIONS, recipientKey } from '@/lib/solana-app/transfer-details';
import { accountHint, accountLengthOk, bankByCode, PH_BANKS, railsLine } from '@/lib/solana-partner/banks';

/**
 * Saved bank recipients, for Transfer's Step 1 (prompt 10 §5.3).
 *
 *   list     name, bank, •••• 4471, "Verified 2 Sep by call-back" or "Not verified", last paid
 *   create   the full number typed twice (the server checks the two match too), sealed in the vault
 *            (Phase S); the recipient keeps only last4. Checked now by phone, or saved to check later:
 *            an unchecked recipient can't be paid.
 *   verify   the call-back passed: payable.
 *
 * The number is never returned, never logged, never put in an error. Seeing it is the reveal route.
 */

export interface Viewer {
  isOwner: boolean;
  role?: string;
}

const METHOD_WORDS: Record<string, string> = { 'call-back': 'by call-back', 'supplier-account': 'from their account record', 'existing-record': 'from an earlier record' };

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A recipient's last payout that reached their bank: when, and what they received (PHP centavos). */
export interface LastPaid {
  at: string;
  amountPhpMinor: bigint;
}

/** When each recipient was last paid, and how much: the newest payout that reached their bank. */
async function lastPaidBy(orgId: string): Promise<Map<string, LastPaid>> {
  const s = store();
  const out = new Map<string, LastPaid>();
  for (const p of await runtime().payments.listByOrg(orgId)) {
    const c = s.invoices.get(p.invoiceId)?.confirmed;
    const at = p.timeline.paidAt;
    if (!c || !at) continue;
    const key = `${c.supplierName}|${c.supplierBank}|${c.supplierAccountLast4}`;
    if (!out.has(key) || out.get(key)!.at < at) out.set(key, { at, amountPhpMinor: p.approval?.receivePhpMinor ?? c.amountPhpMinor });
  }
  return out;
}

/** The recipient's country, by name. The payout partner pays banks in the Philippines only. */
const COUNTRY_NAME: Record<string, string> = { PH: 'Philippines' };

/** The answers given with the last transfer to this recipient (Step 2 offers them again). Never the recipient's own details. */
function lastAnswers(org: OrgRecord | null, s: SupplierRecord) {
  const d = org?.recipientDetails?.[recipientKey({ supplierName: s.name, supplierBank: s.bank, supplierAccountLast4: s.accountLast4 })];
  return d ? { purpose: d.purpose, description: d.description, relationship: d.relationship, sourceOfFunds: d.sourceOfFunds } : null;
}

export function recipientRow(s: SupplierRecord, last: LastPaid | null, viewer: Viewer, org: OrgRecord | null = null) {
  const payable = Boolean(s.verified) && !s.pendingCallBack;
  const lastPaidAt = last?.at ?? null;
  return {
    id: s.id,
    name: s.name,
    bank: s.bank,
    bankCode: s.bankCode ?? null,
    accountLast4: s.accountLast4,
    payable,
    status: payable
      ? `Verified ${shortDate(s.verified!.at)} ${METHOD_WORDS[s.verified!.method] ?? ''}`.trim()
      : s.pendingCallBack?.previousLast4
        ? `Not verified · bank details changed ${shortDate(s.pendingCallBack.since)}`
        : 'Not verified',
    lastPaidAt,
    lastPaid: lastPaidAt ? `Last paid ${shortDate(lastPaidAt)}` : 'Not paid yet',
    /** Prompt 12 §6.1: the Recipients list shows these as they are. */
    lastPaidPhpMinor: last?.amountPhpMinor ?? null,
    country: COUNTRY_NAME[s.country ?? 'PH'] ?? s.country ?? 'Philippines',
    verifiedAt: payable ? s.verified!.at : null,
    verifiedBy: payable ? s.verified!.method : null,
    hasFullNumber: Boolean(s.secretId),
    canReveal: Boolean(s.secretId) && mayRevealBankNumbers(viewer),
    canRemove: viewer.isOwner,
    lastAnswers: lastAnswers(org, s),
  };
}

export async function listRecipients(orgId: string, viewer: Viewer) {
  const org = getOrg(orgId);
  const paid = await lastPaidBy(orgId);
  const rows = org.suppliers.map((s) => recipientRow(s, paid.get(`${s.name}|${s.bank}|${s.accountLast4}`) ?? null, viewer, org));
  // Payable first, then the most recently paid, then by name.
  rows.sort((a, b) => Number(b.payable) - Number(a.payable) || (b.lastPaidAt ?? '').localeCompare(a.lastPaidAt ?? '') || a.name.localeCompare(b.name));
  return { recipients: rows, banks: PH_BANKS.map((b) => ({ code: b.code, name: b.name, rails: railsLine(b), hint: accountHint(b), accountDigits: b.accountDigits })), detailsOptions: DETAILS_OPTIONS };
}

export interface NewRecipient {
  name: string;
  kind: 'business' | 'person';
  /** A business: its SEC or DTI number. */
  registration?: string | null;
  /** A person: an ID number, or a date of birth (YYYY-MM-DD). */
  personId?: string | null;
  bankCode: string;
  accountNumber: string;
  /** Typed a second time; must match. */
  accountNumberAgain: string;
  holderName: string;
  addressLine: string;
  city: string;
  /** "Now, by phone": who made the call. "Later": nobody yet, and it can't be paid until someone does. */
  check: { when: 'now'; by: string } | { when: 'later' };
}

export async function createRecipient(orgId: string, input: NewRecipient, viewer: Viewer & { by: string }, now = new Date()) {
  if (viewer.role === 'viewer') throw new ServiceError('not_authorized', 'A viewer can’t add recipients.', 403);
  const org = getOrg(orgId);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new ServiceError('bad_request', 'Give the recipient’s name.', 422);
  const bank = bankByCode(input.bankCode);
  if (!bank) throw new ServiceError('bad_request', 'Choose the recipient’s bank.', 422);
  let digits: string;
  try {
    digits = normaliseAccountNumber(input.accountNumber);
  } catch {
    throw new ServiceError('bad_request', `Check the account number: ${accountHint(bank)}.`, 422);
  }
  let again = '';
  try {
    again = normaliseAccountNumber(input.accountNumberAgain);
  } catch {
    again = '';
  }
  if (again !== digits) throw new ServiceError('bad_request', 'The two account numbers don’t match. Type it again.', 422, { field: 'accountNumberAgain' });
  if (!accountLengthOk(bank, digits)) throw new ServiceError('bad_request', `Check the account number: ${accountHint(bank)}.`, 422, { field: 'accountNumber' });
  const registration = input.kind === 'business' ? (input.registration ?? '').trim() : null;
  if (input.kind === 'business' && !/^[A-Za-z0-9-]{5,24}$/.test(registration ?? '')) throw new ServiceError('bad_request', 'Give their SEC or DTI registration number.', 422, { field: 'registration' });
  const personId = input.kind === 'person' ? (input.personId ?? '').trim() : '';
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(personId) ? personId : null;
  if (input.kind === 'person' && !dob && personId.length < 3) throw new ServiceError('bad_request', 'Give their ID number or date of birth.', 422, { field: 'personId' });
  const holderName = input.holderName.trim();
  if (holderName.length < 2) throw new ServiceError('bad_request', 'Give the account holder’s name, as the bank has it.', 422, { field: 'holderName' });
  const addressLine = input.addressLine.trim();
  if (addressLine.length < 3) throw new ServiceError('bad_request', 'Give their street address.', 422, { field: 'addressLine' });
  const city = input.city.trim();
  if (city.length < 2) throw new ServiceError('bad_request', 'Give their city.', 422, { field: 'city' });
  if (input.check.when === 'now' && input.check.by.trim().length < 2) throw new ServiceError('bad_request', 'Say who made the call-back.', 422);

  // The same account saved twice is one recipient: the fingerprint finds it without opening anything.
  const fp = await fingerprintOf(kmsFromEnv(), bank.code, digits).catch((e) => {
    throw e instanceof VaultError ? new ServiceError('bad_request', 'Check the account number.', 422) : e;
  });
  for (const existing of await runtime().secrets.findByFingerprint(orgId, fp)) {
    const holder = org.suppliers.find((x) => x.id === existing.beneficiaryId && x.secretId === existing.id);
    if (holder) throw new ServiceError('bad_request', `This account is already saved, as ${holder.name}.`, 409, { recipientId: holder.id });
  }

  const at = now.toISOString();
  const supplier: SupplierRecord = {
    id: newSupplierId(),
    name,
    bank: bank.name,
    accountLast4: digits.slice(-4),
    verified: input.check.when === 'now' ? { by: input.check.by.trim(), method: 'call-back', at } : null,
    bankCode: bank.code,
    partnerRecipient: {
      type: input.kind === 'business' ? 'business' : 'individual',
      registrationNumber: registration,
      idNumber: input.kind === 'person' && !dob ? personId : null,
      dateOfBirth: dob,
      addressLine1: addressLine,
      addressCity: city,
      addressCountry: 'PH',
      accountName: holderName,
    },
    country: 'PH',
    createdAt: at,
    createdBy: viewer.by,
  };
  org.suppliers.push(supplier);
  try {
    await saveBankNumber(orgId, supplier.id, { bankCode: bank.code, accountNumber: digits }, now);
  } catch (e) {
    org.suppliers = org.suppliers.filter((x) => x !== supplier);
    throw e;
  }
  if (input.check.when === 'later') supplier.pendingCallBack = { since: at, previousLast4: null };
  return recipientRow(supplier, null, viewer);
}

/** The call-back passed: the recipient can be paid. */
export function verifyRecipient(orgId: string, recipientId: string, input: { by: string }, viewer: Viewer, now = new Date()) {
  if (viewer.role === 'viewer') throw new ServiceError('not_authorized', 'A viewer can’t record a call-back.', 403);
  if (input.by.trim().length < 2) throw new ServiceError('bad_request', 'Say who made the call-back.', 422);
  const s = markBankDetailsVerified(orgId, recipientId, input.by.trim(), 'call-back', now);
  return recipientRow(s, null, viewer);
}
