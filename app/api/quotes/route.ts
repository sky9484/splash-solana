import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';
import { calculateQuote } from '@/lib/server/quote';

export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const fromAmountSen = body.fromAmount === undefined
    ? Math.round(Number(body.amount ?? 0) * 100)
    : Math.round(Number(body.fromAmount ?? 0));
  const targetCurrency = String(body.targetCurrency ?? 'PHP');
  const recipientId = typeof body.recipientId === 'string' ? body.recipientId : undefined;
  const feeTier = body.fundingFeeTier === 'DISCOUNT' ? 'DISCOUNT' : 'STANDARD';

  if (!Number.isFinite(fromAmountSen) || fromAmountSen <= 0) {
    return NextResponse.json({ error: 'A positive source amount is required' }, { status: 400 });
  }

  const quote = await calculateQuote(fromAmountSen, recipientId, targetCurrency, feeTier);

  return NextResponse.json(quote);
}
