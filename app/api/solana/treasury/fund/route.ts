import { readBody, schemas } from '@/lib/solana-app/http';
import { fundTreasury } from '@/lib/solana-app/treasury-service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Offline: credit 100,000 test USDC to the treasury through the simulator. Devnet: answers with the treasury address and the faucet link. */
export async function POST(request: Request) {
  return companyRoute(request, async (ctx) => {
    await readBody(request, schemas.empty);
    return await fundTreasury(ctx.orgId);
  });
}
