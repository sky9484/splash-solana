import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { invoiceView, startPeerTransfer } from '@/lib/solana-app/service';
import { DirectoryError, payeeFor } from '@/lib/server/splash-directory';
import { companyRoute, requireMoneyGates, requireReadyToApprove } from '@/lib/server/solana-company';
import { setupDb } from '@/lib/server/setup-member';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A payment to another business on Splash (prompt 10 §5.1). The body names the business; where the money
 * lands (its own Payments account) is read again here from the directory, never taken from the browser.
 * The answer is a confirmed record: quote it next (POST /payments), as every payment.
 */
export async function POST(request: Request) {
  return companyRoute(
    request,
    async (ctx) => {
      const body = await readBody(request, schemas.peerTransfer);
      requireReadyToApprove(ctx);
      await requireMoneyGates(ctx);
      if (!process.env.DATABASE_URL) throw new ServiceError('bad_request', 'Paying a business on Splash needs the database; it is off in this demo.', 409);
      const payee = await payeeFor(await setupDb(), ctx.orgId, body.payeeOrgId).catch((e) => {
        throw e instanceof DirectoryError ? new ServiceError('bad_request', e.message, e.status) : e;
      });
      const inv = startPeerTransfer(ctx.orgId, { payee, amountUsdMinor: body.amountUsdMinor, note: body.note ?? null, reference: body.reference ?? null, by: ctx.personName });
      return { invoice: invoiceView(inv) };
    },
    201,
  );
}
