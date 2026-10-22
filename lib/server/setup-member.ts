import { NextResponse } from 'next/server';

import { UnauthorizedError, resolveAuthorityForSession } from '@/lib/auth/authority';
import type { CustomerSession, CustomerWorkspaceRole } from '@/lib/auth/customer-session';
import type { SetupMember } from '@/lib/solana-app/account-setup';
import { requireCustomerRequest } from '@/lib/server/customer-auth';

/** The membership row's role (lib/auth/authority.ts maps it to the proposal domain) back in workspace words. */
const WORKSPACE_ROLE: Record<string, CustomerWorkspaceRole> = { OWNER: 'admin', APPROVER: 'checker', MAKER: 'maker', VIEWER: 'viewer' };

/**
 * The member behind a setup request: a signed-in session (same-origin, idle
 * clock respected) AND a membership row. Who the person is comes from the
 * session; which organisation and whether they own it comes from the
 * database, never from the request body.
 */
export async function setupMemberForRequest(
  request: Request,
): Promise<
  | { member: SetupMember; role: CustomerWorkspaceRole; email: string; session: CustomerSession; response: null }
  | { member: null; role: null; email: null; session: null; response: Response }
> {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return { member: null, role: null, email: null, session: null, response: auth.response };
  try {
    const ctx = await resolveAuthorityForSession(auth.session);
    return {
      member: { userId: ctx.userId, orgId: ctx.orgId, isOwner: ctx.role === 'OWNER' },
      // The member's role from the membership row, read on this request (never the session's display copy).
      role: WORKSPACE_ROLE[ctx.role] ?? 'viewer',
      email: auth.session.email,
      session: auth.session,
      response: null,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return {
        member: null,
        role: null,
        email: null,
        session: null,
        response: NextResponse.json(
          {
            error: {
              code: 'no_membership',
              message: 'Your sign-in works, but you have not been given access to a company yet. Finish business verification, or ask your company’s owner to invite you.',
            },
          },
          { status: 403, headers: { 'Cache-Control': 'no-store' } },
        ),
      };
    }
    throw error;
  }
}

export async function setupDb() {
  const { getDb } = await import('@/lib/db/client');
  return getDb() as never;
}
