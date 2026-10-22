import { readBody, schemas } from '@/lib/solana-app/http';
import { prepareMove } from '@/lib/solana-app/treasury-service';
import { companyRoute, requireMoneyGates, requireReadyToApprove } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The unsigned transactions for a move between the company's own vaults, for THIS member's device:
 * proposal and execute for a new move, or the execute alone to retry one whose proposal landed.
 */
export async function POST(request: Request) {
  return companyRoute(request, async (ctx) => {
    const body = await readBody(request, schemas.movePrepare);
    const { deviceKey } = requireReadyToApprove(ctx);
    await requireMoneyGates(ctx);
    return await prepareMove(
      ctx.orgId,
      'retryMoveId' in body
        ? { retryMoveId: body.retryMoveId, signer: deviceKey, by: ctx.personName }
        : { from: body.from, amountMinor: BigInt(body.amountMinor), signer: deviceKey, by: ctx.personName },
    );
  });
}
