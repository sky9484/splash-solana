import { handle } from '@/lib/solana-app/http';
import { evidencePackResponse } from '@/lib/solana-app/pack-response';
import { sharedReceipt } from '@/lib/solana-app/shared-receipt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The evidence pack behind a shared receipt: the business chose to hand this auditor the invoice fields and salt. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const { share } = await sharedReceipt(token);
    return await evidencePackResponse(share.receiptId);
  } catch (e) {
    return handle(() => {
      throw e;
    });
  }
}
