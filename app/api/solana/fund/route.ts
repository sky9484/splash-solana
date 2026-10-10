import { handle, readBody, schemas } from '@/lib/solana-app/http';
import { fund } from '@/lib/solana-app/service';

/** Offline: credit 25,000 test USDC through the simulator. Devnet: answers with the vault address and the faucet link. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request, schemas.orgOnly);
    return await fund(body.orgId);
  });
}
