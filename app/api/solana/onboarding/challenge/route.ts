import { handle, readBody, schemas } from '@/lib/solana-app/http';
import { issueChallenges } from '@/lib/solana-app/service';

/** Proof-of-possession nonces for the device key and the recovery kit's PUBLIC keys. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request, schemas.challenge);
    return { challenges: issueChallenges(body.orgId, body.keys) };
  });
}
