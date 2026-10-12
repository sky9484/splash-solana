import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ServiceError } from '@/lib/solana-app/errors';
import { adminSuspend, adminUnsuspend } from '@/lib/solana-app/admin-service';
import { getAdminSession } from '@/lib/server/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ action: z.enum(['suspend', 'unsuspend']), reason: z.string().trim().min(3).max(500) }).strict();
const ORG_ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Refuse service, or restore it (prompt 07 §7.5). Subtractive only: a suspended company gets no
 * fee-payer signature and can start no new proposal; its vault stays its own, and Splash cannot
 * freeze or move the money in it. Compliance and operations staff only; support can see, not act.
 * Every change is appended to the company's audit log with the staff member and the reason.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: { code: 'not_authorized', message: 'Staff sign-in required.' } }, { status: 401 });
  if (session.role !== 'compliance' && session.role !== 'operations') {
    return NextResponse.json({ error: { code: 'not_authorized', message: 'Only compliance or operations staff can change service.' } }, { status: 403 });
  }
  const { orgId } = await params;
  if (!ORG_ID.test(orgId)) return NextResponse.json({ error: { code: 'org_not_found', message: 'No such company.' } }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: 'bad_request', message: 'Choose suspend or unsuspend, and give a reason of 3 to 500 characters.' } }, { status: 400 });
  try {
    const { action, reason } = parsed.data;
    const suspended = action === 'suspend' ? await adminSuspend(orgId, session.email, reason) : await adminUnsuspend(orgId, session.email, reason);
    return NextResponse.json({ orgId, suspended });
  } catch (e) {
    if (e instanceof ServiceError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    throw e;
  }
}
