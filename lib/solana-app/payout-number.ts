/**
 * The one place a full bank number is opened for a payout (prompt 10 §S.1.5): while the payout
 * instruction for the partner is built, just in time, and never stored with the payment (the payment
 * keeps the bank and last4). Refused while changed details wait for their call-back.
 *
 * An invoice's own number (§6.2) is opened here too, for its payout, and once to save it with the
 * supplier the payment saved. The other place a number is opened is a person's reveal
 * (lib/server/bank-details.ts).
 * tests/pii-no-leaks.test.mjs fails if any third file calls `openNumber`.
 */
import { kmsFromEnv } from '../server/kms/index.ts';
import { openNumber, sealNumber, VaultError } from '../server/pii-vault.ts';
import { ServiceError } from './errors.ts';
import { UNLISTED_BANK } from './invoice-number.ts';
import { runtime } from './runtime.ts';
import type { InvoiceRecord, SupplierRecord } from './store.ts';

export async function openForPayout(orgId: string, supplier: SupplierRecord): Promise<{ accountNumber: string; last4: string }> {
  if (supplier.pendingCallBack || !supplier.verified) throw new ServiceError('bank_details_unverified', 'This recipient’s bank details changed. Call them on a number you already have to confirm, then pay.', 409);
  const secret = await runtime().secrets.current(orgId, supplier.id);
  if (!secret) throw new ServiceError('bank_number_unavailable', 'This recipient has no full account number on file.', 409);
  try {
    return { accountNumber: await openNumber(kmsFromEnv(), secret, { orgId, beneficiaryId: supplier.id }), last4: secret.last4 };
  } catch (e) {
    if (e instanceof VaultError) throw new ServiceError('bank_number_unavailable', e.message, 409);
    throw e;
  }
}

/**
 * An invoice's own number (prompt 10 §6.2), for the payout of that invoice: only once its bank details
 * passed a call-back, or are a saved recipient's checked details. Null when the invoice printed no
 * full number (the partner then gets what the saved recipient has, or last4 alone).
 */
export async function openInvoiceForPayout(orgId: string, inv: InvoiceRecord): Promise<{ accountNumber: string; last4: string } | null> {
  if (!inv.accountSecretId) return null;
  if (!inv.confirmed?.bankDetailsVerified) throw new ServiceError('bank_details_unverified', 'This invoice’s bank details need a call-back before it can be paid.', 409);
  const secret = await runtime().secrets.current(orgId, inv.id);
  if (!secret) return null;
  // The number printed on the invoice must be the one the confirmed details name. Without this, the
  // last four digits could be edited to a trusted supplier's while the payout went to the printed
  // number, and paying would then copy that number onto the trusted supplier (review finding, 16 Oct).
  if (secret.last4 !== inv.confirmed.supplierAccountLast4) {
    throw new ServiceError('bank_details_unverified', 'The account number on this invoice doesn’t end in the digits you confirmed. Check the invoice and call the supplier on a number you already have.', 409);
  }
  try {
    return { accountNumber: await openNumber(kmsFromEnv(), secret, { orgId, beneficiaryId: inv.id }), last4: secret.last4 };
  } catch (e) {
    if (e instanceof VaultError) throw new ServiceError('bank_number_unavailable', e.message, 409);
    throw e;
  }
}

/**
 * A supplier saved (or re-checked) by paying an invoice keeps that invoice's full number: opened from
 * the invoice's record and sealed again under the supplier, so the next transfer to them carries it.
 * The same number already on file changes nothing.
 */
export async function adoptInvoiceNumber(orgId: string, inv: InvoiceRecord, supplier: SupplierRecord, now = new Date()): Promise<boolean> {
  const opened = await openInvoiceForPayout(orgId, inv);
  if (!opened) return false;
  const kms = kmsFromEnv();
  const sealed = await sealNumber(kms, { orgId, beneficiaryId: supplier.id, bankCode: inv.bankCode ?? supplier.bankCode ?? UNLISTED_BANK, accountNumber: opened.accountNumber });
  const secrets = runtime().secrets;
  const current = await secrets.current(orgId, supplier.id);
  if (current && current.fingerprint === sealed.fingerprint) return false;
  const { secret } = await secrets.putCurrent({ orgId, beneficiaryId: supplier.id, ...sealed }, now);
  supplier.secretId = secret.id;
  supplier.accountLast4 = secret.last4;
  if (inv.bankCode && !supplier.bankCode) supplier.bankCode = inv.bankCode;
  return true;
}
