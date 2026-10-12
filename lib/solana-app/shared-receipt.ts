/**
 * The auditor's side of "Share with auditor": a token opens one receipt and nothing else, with no
 * sign-in. Used by the public receipt page and its API routes.
 */
import { companyOf, loadCompany } from './company.ts';
import { ServiceError } from './errors.ts';
import { openShare, receiptView } from './service.ts';

export async function sharedReceipt(token: string) {
  if (!/^shr_[0-9a-f]{32}$/.test(token)) throw new ServiceError('receipt_not_found', 'This receipt link is not valid. Ask the business that shared it for a new one.', 404);
  const orgId = await companyOf('share', token);
  if (!orgId) throw new ServiceError('receipt_not_found', 'This receipt link is not valid. Ask the business that shared it for a new one.', 404);
  await loadCompany(orgId);
  const share = openShare(token);
  return { share, receipt: await receiptView(share.receiptId) };
}
