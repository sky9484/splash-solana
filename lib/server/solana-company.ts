import { eq } from 'drizzle-orm';

import type { CustomerSession, CustomerWorkspaceRole } from '@/lib/auth/customer-session';
import { findActiveDevice, findOrgVault, type OrgVault } from '@/lib/auth/devices';
import { organizations, users } from '@/lib/db/schema';
import { loadCompany, saveCompany } from '@/lib/solana-app/company';
import { ServiceError } from '@/lib/solana-app/errors';
import { handle } from '@/lib/solana-app/http';
import { jsonResponse } from '@/lib/solana-app/json';
import { syncAccountCompany, type AccountCompany } from '@/lib/solana-app/service';
import { laneInScope } from '@/lib/launch-scope-rules';
import { requireActiveOrg } from '@/lib/server/kyb-gate';
import { launchScope } from '@/lib/server/launch-scope';
import { requireTermsAccepted } from '@/lib/server/onboarding';
import { setupDb, setupMemberForRequest } from '@/lib/server/setup-member';

/**
 * The signed-in member's company on the Solana app (prompt 07 §6.2). Every /api/solana route that
 * acts for a company starts here:
 *
 *   who      the session (same-origin, idle clock respected): never the request body
 *   which    the membership row: the dashboard organization IS the Solana company
 *   what     the vault and this member's device, as account setup recorded them
 *
 * The company's documents are loaded before the route runs and the ones it changed are written back
 * after, whether it succeeded or not (lib/solana-app/company.ts).
 */
export interface CompanyContext {
  orgId: string;
  userId: string;
  isOwner: boolean;
  /** The member's role, from the membership row on this request. Checks read this, never the session. */
  role: CustomerWorkspaceRole;
  email: string;
  personName: string;
  companyName: string;
  /** This member's device key, or null before setup. */
  deviceKey: string | null;
  vault: OrgVault | null;
  session: CustomerSession;
}

function toServiceVault(v: OrgVault): AccountCompany['vault'] {
  return {
    multisigPda: v.multisigPda,
    vaultPda: v.vaultPda,
    threshold: v.threshold,
    members: v.members.map((m) => ({ role: m.role, publicKey: m.publicKey })),
    configAuthority: null,
    createdAt: v.createdAt.toISOString(),
    signature: v.createSignature,
    simulated: v.simulated,
    cluster: v.cluster,
  };
}

/** Auth failures in the Solana API's error shape, so the browser shows one kind of message. */
async function reshape(response: Response): Promise<Response> {
  if (response.status === 401) {
    return jsonResponse({ error: { code: 'sign_in_required', message: 'Your session ended. Sign in again to continue.' } }, { status: 401 });
  }
  const body = (await response.clone().json().catch(() => null)) as { error?: unknown; code?: string } | null;
  if (body && typeof body.error === 'string') {
    return jsonResponse({ error: { code: body.code ?? 'not_allowed', message: body.error } }, { status: response.status });
  }
  return response;
}

export async function companyForRequest(request: Request): Promise<{ ctx: CompanyContext; response: null } | { ctx: null; response: Response }> {
  const auth = await setupMemberForRequest(request);
  if (!auth.member) return { ctx: null, response: await reshape(auth.response) };
  const db = await setupDb();
  const { getDb } = await import('@/lib/db/client');
  const q = getDb();
  const [[org], [user], device, vault] = await Promise.all([
    q.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, auth.member.orgId)).limit(1),
    q.select({ name: users.name }).from(users).where(eq(users.id, auth.member.userId)).limit(1),
    findActiveDevice(db, auth.member),
    findOrgVault(db, auth.member.orgId),
  ]);
  const ctx: CompanyContext = {
    orgId: auth.member.orgId,
    userId: auth.member.userId,
    isOwner: auth.member.isOwner,
    role: auth.role,
    email: auth.email,
    personName: user?.name?.trim() || auth.email,
    companyName: org?.name ?? auth.member.orgId,
    deviceKey: device?.publicKey ?? null,
    vault,
    session: auth.session,
  };
  await loadCompany(ctx.orgId);
  await syncAccountCompany({ orgId: ctx.orgId, companyName: ctx.companyName, personName: ctx.personName, vault: vault ? toServiceVault(vault) : null, deviceKey: ctx.deviceKey });
  return { ctx, response: null };
}

/** A company-scoped route: auth, load, run, write back, and errors in the product's voice. */
export async function companyRoute(request: Request, run: (ctx: CompanyContext) => Promise<unknown>, status = 200): Promise<Response> {
  let bound: Awaited<ReturnType<typeof companyForRequest>>;
  try {
    bound = await companyForRequest(request);
  } catch (e) {
    return handle(() => {
      throw e;
    });
  }
  if (bound.response) return bound.response;
  const { ctx } = bound;
  return handle(async () => {
    try {
      return await run(ctx);
    } finally {
      await saveCompany(ctx.orgId);
    }
  }, status);
}

/**
 * The same gates the dashboard's padlocks show, enforced where money moves: the launch scope must
 * include payouts to a bank in local currency (the payout partner pays the supplier's bank), the
 * business must be verified (KYB), and the current terms accepted. Run before a quote and before
 * every device prompt and send.
 */
export async function requireMoneyGates(ctx: CompanyContext): Promise<void> {
  if (!laneInScope('FIAT_OUT_LOCAL', launchScope())) {
    throw new ServiceError('not_in_launch_scope', 'Payouts to a supplier’s bank are not open on this launch yet. Nothing was sent.', 403);
  }
  const kyb = await requireActiveOrg(ctx.session, { lane: 'FIAT_OUT_LOCAL' });
  if (kyb.response) {
    const body = (await kyb.response.json().catch(() => null)) as { error?: string } | null;
    throw new ServiceError('kyb_not_active', body?.error ?? 'Finish business verification before paying suppliers.', 403);
  }
  const terms = await requireTermsAccepted(ctx.orgId);
  if (terms) throw new ServiceError('terms_not_accepted', 'Accept the current terms in Account setup before paying suppliers.', 412);
}

/** Money routes need a device on record and a vault with that device in it. */
/**
 * A viewer reads; it never changes what gets paid. Every route that confirms a bill, quotes, discards
 * or funds a payment, sends or cancels a request, or saves a template calls this first.
 */
export function requireCanAct(ctx: CompanyContext): void {
  if (ctx.role === 'viewer') throw new ServiceError('not_authorized', 'Viewers can see payments but can’t change them. Ask your owner for a role that can.', 403);
}

export function requireReadyToApprove(ctx: CompanyContext): { deviceKey: string; vault: OrgVault } {
  if (!ctx.vault) throw new ServiceError('vault_missing', 'Your company has no vault yet. Finish setup first.', 409);
  if (!ctx.deviceKey) throw new ServiceError('keys_missing', 'Set up this device first: approvals are signed on it.', 409);
  if (!ctx.vault.members.some((m) => m.publicKey === ctx.deviceKey)) {
    throw new ServiceError('not_an_approver', 'This device is registered but is not a member of the vault yet. The vault’s members add it with an approval.', 403);
  }
  return { deviceKey: ctx.deviceKey, vault: ctx.vault };
}
