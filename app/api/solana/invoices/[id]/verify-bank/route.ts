import { recordCallBack } from '@/lib/solana-app/bills';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Record the call-back" (prompt 10 §6.2): the person signed in made the call, to the number they give
 * (from the company's own records, never one printed on the invoice), and spoke to the person they name.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    const body = await readBody(request, schemas.callBack);
    return { bankVerification: recordCallBack(ctx.orgId, id, { by: ctx.personName, spokeTo: body.spokeTo, numberCalled: body.numberCalled, role: ctx.session.userRole }) };
  });
}
