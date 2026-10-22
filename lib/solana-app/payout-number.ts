/**
 * The one place a full bank number is opened for a payout (prompt 10 §S.1.5): while the payout
 * instruction for the partner is built, just in time, and never stored with the payment (the payment
 * keeps the bank and last4). Refused while changed details wait for their call-back.
 *
 * The other place a number is opened is a person's reveal (lib/server/bank-details.ts).
 * tests/pii-no-leaks.test.mjs fails if any third file calls `openNumber`.
 */
import { kmsFromEnv } from '../server/kms/index.ts';
import { openNumber, VaultError } from '../server/pii-vault.ts';
import { ServiceError } from './errors.ts';
import { runtime } from './runtime.ts';
import type { SupplierRecord } from './store.ts';

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
