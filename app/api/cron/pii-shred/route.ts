import { shredDue } from '@/lib/server/bank-details';
import { cronAuthorized } from '@/lib/server/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The daily crypto-shred (prompt 10 §S.1.8): a removed recipient's bank number is destroyed 30 days
 * after its last payment settled. This deletes the ciphertext and the wrapped data key of every due
 * record and stamps `shredded_at`; last4, the fingerprint and the payment records stay for 7 years.
 * Running it twice does nothing the second time.
 *
 * Only the scheduler may call it (lib/server/cron-auth.ts).
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ success: false, error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const { shredded } = await shredDue();
  return Response.json({ success: true, shredded }, { headers: { 'Cache-Control': 'no-store' } });
}
