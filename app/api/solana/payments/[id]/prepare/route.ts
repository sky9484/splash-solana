import { paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { prepareApproval } from '@/lib/solana-app/service';
import { companyRoute, requireReadyToApprove } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Unsigned Squads proposal and execute messages for THIS member's device key to sign in the browser.
 * The signer is the device on record for the signed-in member, never a key the browser names.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    await readBody(request, schemas.empty);
    const { deviceKey } = requireReadyToApprove(ctx);
    await paymentFor(id, ctx.orgId);
    return await prepareApproval(id, { signer: deviceKey });
  });
}
