import { handle } from '@/lib/solana-app/http';
import { receiptView } from '@/lib/solana-app/service';

export const dynamic = 'force-dynamic';

/** The receipt: bundle, Merkle proof and anchor, for verification in the browser. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    return { receipt: await receiptView(id) };
  });
}
