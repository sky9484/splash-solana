import { handle } from '@/lib/solana-app/http';
import { evidenceBlob } from '@/lib/solana-app/service';
import { sharedReceipt } from '@/lib/solana-app/shared-receipt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The sealed record behind a shared receipt, for the integrity check in the auditor's browser. Ciphertext only. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await params;
    const { share } = await sharedReceipt(token);
    return { blob: await evidenceBlob(share.receiptId) };
  });
}
