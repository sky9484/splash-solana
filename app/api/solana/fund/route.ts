import { readBody, schemas } from '@/lib/solana-app/http';
import { fund } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Offline: credit 25,000 test USDC through the simulator. Devnet: answers with the vault address and the faucet link. */
export async function POST(request: Request) {
  return companyRoute(request, async (ctx) => {
    await readBody(request, schemas.empty);
    return await fund(ctx.orgId);
  });
}
