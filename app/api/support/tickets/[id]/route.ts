import { NextResponse } from 'next/server';

import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';
import { readSupportTicket, updateSupportTicket } from '@/lib/server/support';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const ticket = readSupportTicket(id);

  if (!ticket) {
    return NextResponse.json({ error: 'Support ticket not found' }, { status: 404 });
  }

  return NextResponse.json({ ticket });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const body = await readJsonBody(request);
  const message = String(body.message ?? '').trim();
  const actor = String(body.email ?? '').trim() || 'customer';

  if (!message) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  const ticket = updateSupportTicket(id, {
    status: 'OPEN',
    actor,
    actorType: 'customer',
    replyMessage: message,
  });

  if (!ticket) {
    return NextResponse.json({ error: 'Support ticket not found' }, { status: 404 });
  }

  return NextResponse.json({ ticket });
}
