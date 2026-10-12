import { z } from 'zod';

import { handle, readBody } from '@/lib/solana-app/http';
import { issueSetupChallenges } from '@/lib/solana-app/account-setup';
import { setupMemberForRequest } from '@/lib/server/setup-member';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const body = z
  .object({ keys: z.array(z.object({ role: z.enum(['device', 'kit']), publicKey: base58 }).strict()).min(1).max(2) })
  .strict();

/** Nonces to sign, one per key. Only public keys arrive here. */
export async function POST(request: Request) {
  const { member, response } = await setupMemberForRequest(request);
  if (!member) return response;
  return handle(async () => {
    const { keys } = await readBody(request, body);
    return { challenges: issueSetupChallenges(member, keys) };
  });
}
