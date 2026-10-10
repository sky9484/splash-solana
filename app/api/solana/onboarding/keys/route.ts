import { handle, readBody, schemas } from '@/lib/solana-app/http';
import { registerKeys } from '@/lib/solana-app/service';

/** Verify the signatures over the nonces. Only public keys and signatures arrive here. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request, schemas.keys);
    return await registerKeys(body.orgId, body.proofs);
  });
}
