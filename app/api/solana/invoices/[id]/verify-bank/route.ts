import { handle, readBody, schemas } from '@/lib/solana-app/http';
import { verifyBank } from '@/lib/solana-app/service';

/** Record who verified new bank details out of band, and how. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(request, schemas.verifyBank);
    return { bankVerification: verifyBank(body.orgId, id, body) };
  });
}
