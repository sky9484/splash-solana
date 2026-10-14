/**
 * The account number printed on a supplier's invoice (prompt 10 §6.2), sealed the moment Zeke reads
 * it, exactly as a recipient's number is (Phase S): envelope encryption under the key service, stored
 * in bank_account_secrets under the invoice's own id. The invoice keeps only the record's id and last4;
 * the document it shows has the number masked.
 *
 * Opening it happens in two places only: a person's reveal (lib/server/bank-details.ts) and the payout
 * (payout-number.ts). Nothing here opens a number.
 */
import { kmsFromEnv } from '../server/kms/index.ts';
import { sealNumber } from '../server/pii-vault.ts';
import { runtime } from './runtime.ts';

/** The bank code used in the fingerprint when the invoice's bank isn't on the partner's list. */
export const UNLISTED_BANK = 'UNLISTED';

export async function sealInvoiceNumber(orgId: string, invoiceId: string, input: { bankCode: string | null; accountNumber: string }, now = new Date()): Promise<{ secretId: string; last4: string }> {
  const sealed = await sealNumber(kmsFromEnv(), { orgId, beneficiaryId: invoiceId, bankCode: input.bankCode ?? UNLISTED_BANK, accountNumber: input.accountNumber });
  const { secret } = await runtime().secrets.putCurrent({ orgId, beneficiaryId: invoiceId, ...sealed }, now);
  return { secretId: secret.id, last4: secret.last4 };
}
