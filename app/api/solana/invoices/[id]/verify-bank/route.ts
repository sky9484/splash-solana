import { readBody, schemas } from '@/lib/solana-app/http';
import { verifyBank } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Record who verified new bank details out of band, and how. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    const body = await readBody(request, schemas.verifyBank);
    return { bankVerification: verifyBank(ctx.orgId, id, body) };
  });
}
