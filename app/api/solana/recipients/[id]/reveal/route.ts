import { logRefusedReveal, revealBankNumber, revealChallenge } from '@/lib/server/bank-details';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * See a recipient's full account number (prompt 10 §S.1.5; decision 15): the owner or a finance admin,
 * after a device approval made seconds ago, for 30 seconds. Every attempt is logged, allowed or refused.
 *
 *   { step: 'challenge' }                     → { nonce, message, expiresAt }   sign `message` with this device's key
 *   { step: 'reveal', nonce, signature }      → { accountNumber, last4, expiresAt }
 *
 * The number travels in this response body only (never cached, never in a URL). Masking it again at
 * `expiresAt` is the page's job (Phase 3, §5.3).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    const actor = { orgId: ctx.orgId, userId: ctx.userId, isOwner: ctx.isOwner, role: ctx.role, deviceKey: ctx.deviceKey };
    // Every attempt is logged, a malformed one too (decision 15).
    const body = await readBody(request, schemas.reveal).catch(async (e) => {
      await logRefusedReveal(actor, id, null, 'malformed request');
      throw e;
    });
    return body.step === 'challenge' ? await revealChallenge(actor, id) : await revealBankNumber(actor, id, { nonce: body.nonce, signature: body.signature });
  });
}
