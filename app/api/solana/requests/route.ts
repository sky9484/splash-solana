import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { createRequest, requestRow, requestsView, sendRequest, type NewRequest } from '@/lib/solana-app/requests';
import { DirectoryError, payeeFor } from '@/lib/server/splash-directory';
import { companyRoute, requireCanAct, requireMoneyGates } from '@/lib/server/solana-company';
import { setupDb } from '@/lib/server/setup-member';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Get paid's list (prompt 10 §6.3): every request, newest first, and what is still owed. */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => requestsView(ctx.orgId));
}

/**
 * A new request, kept as a draft or sent. A business on Splash is read again from the server's directory
 * (never taken from the browser): it lands in its inbox, ready to pay. Anyone else gets a link.
 */
export async function POST(request: Request) {
  return companyRoute(
    request,
    async (ctx) => {
      requireCanAct(ctx);
      const body = await readBody(request, schemas.paymentRequest);
      await requireMoneyGates(ctx);
      let payer: NewRequest['payer'];
      if (body.payer.kind === 'splash') {
        if (!process.env.DATABASE_URL) throw new ServiceError('bad_request', 'Asking a business on Splash needs the database; it is off in this demo.', 409);
        const found = await payeeFor(await setupDb(), ctx.orgId, body.payer.payerOrgId).catch((e) => {
          throw e instanceof DirectoryError ? new ServiceError('bad_request', e.message, e.status) : e;
        });
        payer = { kind: 'splash', orgId: found.payeeOrgId, name: found.payeeName, handle: found.payeeHandle, country: found.payeeCountry };
      } else {
        payer = { kind: 'external', name: body.payer.name, email: body.payer.email };
      }
      const r = createRequest(ctx.orgId, { payer, number: body.number, dueDate: body.dueDate, lines: body.lines, myInvoisRef: body.myInvoisRef ?? null, note: body.note ?? null }, ctx.personName);
      const out = body.send ? await sendRequest(ctx.orgId, r.id) : r;
      return { request: requestRow(out, new Date()) };
    },
    201,
  );
}
