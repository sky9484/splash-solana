import { logRefusedReveal, revealBankNumber, revealChallenge } from '@/lib/server/bank-details';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Show number" on Check the invoice (prompt 10 §6.2): the account number printed on the invoice, sealed
 * when Zeke read it, shown as a recipient's is (decision 15): the owner or a finance admin, after a
 * device approval made seconds ago, for 30 seconds. Every attempt is logged, allowed or refused.
 *
 *   { step: 'challenge' }                     → { nonce, message, expiresAt }
 *   { step: 'reveal', nonce, signature }      → { accountNumber, last4, expiresAt }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    const actor = { orgId: ctx.orgId, userId: ctx.userId, isOwner: ctx.isOwner, role: ctx.role, deviceKey: ctx.deviceKey };
    const body = await readBody(request, schemas.reveal).catch(async (e) => {
      await logRefusedReveal(actor, id, null, 'malformed request');
      throw e;
    });
    return body.step === 'challenge' ? await revealChallenge(actor, id) : await revealBankNumber(actor, id, { nonce: body.nonce, signature: body.signature });
  });
}
