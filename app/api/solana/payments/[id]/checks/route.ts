import { ServiceError } from '@/lib/solana-app/errors';
import { paymentFor } from '@/lib/solana-app/http';
import { previewChecks } from '@/lib/solana-app/service';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Transfer, Step 3: "Passed 8 of 8 rules" for the route a person is looking at (prompt 10 §5.6). A
 * read: it changes nothing. The same rules run again when the route is chosen and before the device
 * approves.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return companyRoute(request, async (ctx) => {
    const { id } = await params;
    await paymentFor(id, ctx.orgId);
    const quoteId = new URL(request.url).searchParams.get('quoteId') ?? '';
    if (!/^rq_[a-z0-9_]{1,77}$/.test(quoteId)) throw new ServiceError('bad_request', 'Say which route to check.');
    return { checks: await previewChecks(id, quoteId) };
  });
}
