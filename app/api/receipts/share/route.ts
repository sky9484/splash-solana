import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';
import { createReceiptShare } from '@/lib/server/receipt-share';

export const dynamic = 'force-dynamic';

/** W9.2 — mint a tokenized read-only receipt link ("Share with supplier").
 *  Auth-gated mint; the resulting /receipt/[token] page renders logged-out. */
export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const body = (await readJsonBody(request).catch(() => null)) as {
    transferIntentId?: string;
    fee?: string;
    reference?: string;
    issuedAt?: string;
  } | null;
  const transferIntentId = body?.transferIntentId;
  if (!transferIntentId) {
    return NextResponse.json({ error: 'transferIntentId is required.' }, { status: 400 });
  }

  const token = createReceiptShare(transferIntentId, {
    fee: body?.fee,
    reference: body?.reference,
    issuedAt: body?.issuedAt,
    approvedBy: auth.session ? `${auth.session.name} · ${auth.session.organization}` : undefined,
  });
  if (!token) {
    return NextResponse.json({ error: 'Transfer not found.' }, { status: 404 });
  }

  return NextResponse.json({ token, url: `/receipt/${token}` });
}
