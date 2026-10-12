import type { NextRequest } from 'next/server';

import { handle, paymentFor, schemas } from '@/lib/solana-app/http';
import { ServiceError } from '@/lib/solana-app/errors';
import { paymentView, resumePayment } from '@/lib/solana-app/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const orgId = request.nextUrl.searchParams.get('orgId') ?? '';
    if (!schemas.orgId.safeParse(orgId).success) throw new ServiceError('bad_request', 'orgId is required.');
    await paymentFor(id, orgId);
    // One status check per poll: moves a payment on if its transaction landed (or expired) meanwhile.
    await resumePayment(id).catch(() => undefined);
    return { payment: await paymentView(id) };
  });
}
