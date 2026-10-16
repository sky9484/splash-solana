import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { resolveAuthorityForSession, UnauthorizedError } from '@/lib/auth/authority';
import { organizations } from '@/lib/db/schema';
import { requireCustomerRequest, requireCustomerSession } from '@/lib/server/customer-auth';
import { readOrgSettings } from '@/lib/server/org-settings';
import { approvalRequiredResponse, consumeActionApproval } from '@/lib/server/step-up-gate';
import { readJsonBody } from '@/lib/server/http';
import {
  cancelPendingRequest,
  getCustomerProfile,
  getPendingRequest,
  listRequestsForCustomer,
  submitProfileChangeRequest,
} from '@/lib/server/customer-profile';

export const dynamic = 'force-dynamic';

/** The signed-in member's company name, from the organizations table; null when there is no membership yet. */
async function companyNameFor(session: Parameters<typeof resolveAuthorityForSession>[0]): Promise<string | null> {
  try {
    const authority = await resolveAuthorityForSession(session);
    const { getDb } = await import('@/lib/db/client');
    const [row] = await getDb().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, authority.orgId)).limit(1);
    return row?.name?.trim() || null;
  } catch (e) {
    if (e instanceof UnauthorizedError) return null;
    throw e;
  }
}

export async function GET() {
  const auth = await requireCustomerSession();
  if (auth.response) return auth.response;
  const { session } = auth;

  return NextResponse.json({
    // Seeded with the company's own name from its organization row, as the dashboard header shows it;
    // the session carries only a placeholder ("Splash Workspace") for some sign-ins.
    profile: getCustomerProfile({ ...session, organization: (await companyNameFor(session)) ?? session.organization }),
    pendingRequest: getPendingRequest(session.email),
    history: listRequestsForCustomer(session.email).slice(0, 10),
  });
}

/** Submit an edit for admin review (maker side of maker-checker). */
export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;
  const { session } = auth;

  const body = await readJsonBody(request);

  // In a workspace with WhatsApp approvals on, submitting a profile change
  // needs a WhatsApp code + passkey approval for exactly these changes. A
  // signed-in person with no workspace yet has no approval style to apply.
  let orgId: string | null = null;
  try {
    orgId = (await resolveAuthorityForSession(session)).orgId;
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
  }
  if (orgId && (await readOrgSettings(orgId)).whatsappEnabled) {
    const approved = await consumeActionApproval({
      session,
      orgId,
      purpose: 'PROFILE_CHANGE',
      payload: body as Record<string, unknown>,
    });
    if (!approved) return approvalRequiredResponse('PROFILE_CHANGE');
  }

  try {
    const changeRequest = submitProfileChangeRequest(session, body as Record<string, unknown>);
    return NextResponse.json({ pendingRequest: changeRequest }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to submit the change request.' },
      { status: 400 },
    );
  }
}

/** Withdraw the pending request. */
export async function DELETE(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;
  const { session } = auth;

  try {
    return NextResponse.json({ request: cancelPendingRequest(session.email) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to cancel the change request.' },
      { status: 400 },
    );
  }
}
