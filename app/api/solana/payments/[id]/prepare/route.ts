import { handle, paymentFor, readBody, schemas } from '@/lib/solana-app/http';
import { prepareApproval } from '@/lib/solana-app/service';

/** Unsigned Squads proposal and execute messages for the device key to sign in the browser. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(request, schemas.orgOnly);
    paymentFor(id, body.orgId);
    return await prepareApproval(id);
  });
}
