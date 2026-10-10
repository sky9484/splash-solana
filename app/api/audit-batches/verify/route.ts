import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { verifyDailyAuditBatch } from '@/lib/server/audit-batches';
import { readJsonBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  try {
    const body = await readJsonBody(request);
    const batchId = typeof body.batchId === 'string' ? body.batchId : '';
    const transferId = typeof body.transferId === 'string' ? body.transferId : '';
    if (!batchId || !transferId) {
      return NextResponse.json({ error: 'batchId and transferId are required' }, { status: 400 });
    }
    return NextResponse.json(await verifyDailyAuditBatch(batchId, transferId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'verification failed' },
      { status: 400 },
    );
  }
}
