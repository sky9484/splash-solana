import { orgSummary } from '@/lib/solana-app/service';
import { deviceKeyIdFor } from '@/lib/solana/device-key';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The signed-in member's company: vault, balance (total = sum of parts), payments, and who is asking
 * (their device, whether it can approve). The company comes from the session, never the URL.
 */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => ({
    ...(await orgSummary(ctx.orgId)),
    me: {
      personName: ctx.personName,
      isOwner: ctx.isOwner,
      deviceKey: ctx.deviceKey,
      keyId: deviceKeyIdFor(ctx.orgId, ctx.userId),
      canApprove: Boolean(ctx.deviceKey && ctx.vault?.members.some((m) => m.publicKey === ctx.deviceKey)),
    },
  }));
}
