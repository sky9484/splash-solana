import { z } from 'zod';

import { handle, readBody } from '@/lib/solana-app/http';
import { completeSetup } from '@/lib/solana-app/account-setup';
import { refreshSetupCookie } from '@/lib/server/setup-gate';
import { setupDb, setupMemberForRequest } from '@/lib/server/setup-member';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,88}$/);
const body = z
  .object({
    proofs: z
      .array(z.object({ role: z.enum(['device', 'kit']), publicKey: base58, nonce: z.string().regex(/^[0-9a-f]{64}$/), signature: base58 }).strict())
      .min(1)
      .max(2),
  })
  .strict();

/**
 * Verify the signatures over the nonces, then create the vault (owner, first
 * time) or join it, and record the device. Public keys and signatures only.
 */
export async function POST(request: Request) {
  const { member, session, response } = await setupMemberForRequest(request);
  if (!member) return response;
  return handle(async () => {
    const { proofs } = await readBody(request, body);
    const result = await completeSetup(await setupDb(), member, proofs);
    await refreshSetupCookie(session);
    return result;
  });
}
