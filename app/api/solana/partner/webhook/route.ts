import { withCompany } from '@/lib/solana-app/company';
import { handle, readBody, schemas } from '@/lib/solana-app/http';
import { getPayment, receivePartnerWebhook } from '@/lib/solana-app/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Payout partner webhook: HMAC-SHA256 verified, deduplicated on paymentId + status. No session: the
 * signature is the authority. The payment names its company, whose evidence this may write.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request, schemas.webhook);
    const p = await getPayment(body.paymentId);
    return await withCompany(p.orgId, () => receivePartnerWebhook(body));
  });
}
