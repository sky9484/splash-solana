import { resolveAuthorityForSession, UnauthorizedError } from '@/lib/auth/authority';
import type { CustomerSession } from '@/lib/auth/customer-session';
import { workspaceForEmail } from '@/lib/auth/signup-org';

/**
 * Which organisation's KYB case a customer request may reach by id.
 *
 * The membership's org, when there is one. A brand-new sign-up has none:
 * password sign-up grants no membership, and POST /api/kyb/upload files its
 * documents under the workspace its email maps to (`ensureWorkspaceForEmail`).
 * Following that case with the id the upload returned — reading it, starting
 * Sumsub on it — is the rest of the same onboarding, so it resolves to that
 * same workspace here. Looked up, never created: a session that has filed
 * nothing finds no case.
 *
 * For routes that take a case id, which only the uploader was given. Not for
 * GET /api/kyb/cases/latest: that needs no id, so this fallback there would
 * hand a workspace's KYB file to anyone who signs up with its email domain.
 */
export async function kybOrgIdForSession(session: CustomerSession): Promise<string> {
  try {
    return (await resolveAuthorityForSession(session)).orgId;
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    return workspaceForEmail(session.email).orgId;
  }
}
