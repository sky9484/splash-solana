import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { listDailyAuditBatches } from '@/lib/server/audit-batches';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  return NextResponse.json({ items: listDailyAuditBatches() });
}
