import { handle, readBody, schemas } from '@/lib/solana-app/http';
import { receivePartnerWebhook } from '@/lib/solana-app/service';

/** Payout partner webhook: HMAC-SHA256 verified, deduplicated on paymentId + status. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request, schemas.webhook);
    return await receivePartnerWebhook(body);
  });
}
