import { handle } from '@/lib/solana-app/http';
import { sharedReceipt } from '@/lib/solana-app/shared-receipt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A shared receipt, no sign-in: the token names one receipt and grants nothing else. With it, when the
 * link stops opening (null for a link made before links expired), so the page can say "Expires {date}".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await params;
    const { receipt, share } = await sharedReceipt(token);
    return { receipt, share: { expiresAt: share.expiresAt ?? null } };
  });
}
