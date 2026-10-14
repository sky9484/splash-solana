/**
 * "Find a business on Splash" (prompt 10 §5.4).
 *
 *   setting   "Let other Splash businesses find us", off by default, under a handle ("@kuchingmarine").
 *   search    by company name, handle or registration number. Only companies that are verified
 *             (KYB lifecycle ACTIVE), chose to be found, and have an account show; never yourself.
 *   payee     resolved again on the server when a payment starts: the browser never says where money
 *             lands. The destination is the payee's own Payments account (its vault #0).
 */
import { and, eq, ilike, ne, or, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { organizations, orgVaults } from '@/lib/db/schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DirectoryDb = PgDatabase<any, any, any>;

export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{2,30}$/;
export const DIRECTORY_LIMIT = 8;

export class DirectoryError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'DirectoryError';
    this.status = status;
  }
}

/** A handle from a company name: "Kuching Marine Supply Sdn Bhd" → "kuching-marine-supply". */
export function handleFrom(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/\b(sdn bhd|bhd|inc|corp|corporation|co|ltd|llc|pte)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 31)
    .replace(/-+$/, '');
  return HANDLE_RE.test(base) ? base : `co-${base}`.slice(0, 31);
}

export async function directorySetting(db: DirectoryDb, orgId: string) {
  const [row] = await db.select({ name: organizations.name, discoverable: organizations.discoverable, handle: organizations.splashHandle, lifecycle: organizations.kybLifecycle }).from(organizations).where(eq(organizations.id, orgId));
  if (!row) throw new DirectoryError('That company is not on file.', 404);
  return { on: row.discoverable, handle: row.handle, suggestedHandle: row.handle ?? handleFrom(row.name), verified: row.lifecycle === 'ACTIVE' };
}

export async function setDirectorySetting(db: DirectoryDb, orgId: string, input: { on: boolean; handle?: string | null }) {
  const current = await directorySetting(db, orgId);
  const handle = (input.handle ?? current.handle ?? current.suggestedHandle).trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE_RE.test(handle)) throw new DirectoryError('A handle is 3 to 31 letters, digits or dashes, starting with a letter or digit.', 422);
  try {
    await db.update(organizations).set({ discoverable: input.on, splashHandle: handle }).where(eq(organizations.id, orgId));
  } catch (e) {
    // drizzle wraps the driver's error; the unique violation (23505) is on the error or its cause.
    const codes = [e, (e as { cause?: unknown })?.cause].map((x) => String((x as { code?: string })?.code ?? ''));
    const text = [e, (e as { cause?: unknown })?.cause].map((x) => String((x as Error)?.message ?? '')).join(' ');
    if (codes.includes('23505') || /organizations_splash_handle_unique|duplicate key/i.test(text)) {
      throw new DirectoryError(`@${handle} is taken. Choose another handle.`, 409);
    }
    throw e;
  }
  return directorySetting(db, orgId);
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface DirectoryHit {
  orgId: string;
  name: string;
  country: string | null;
  handle: string | null;
  verified: true;
}

export async function searchDirectory(db: DirectoryDb, selfOrgId: string, rawQuery: string): Promise<DirectoryHit[]> {
  const q = rawQuery.trim().replace(/^@/, '');
  if (q.length < 2) return [];
  const like = `%${escapeLike(q)}%`;
  const rows = await db
    .select({ orgId: organizations.id, name: organizations.name, country: organizations.addressCountry, handle: organizations.splashHandle })
    .from(organizations)
    .innerJoin(orgVaults, eq(orgVaults.orgId, organizations.id))
    .where(
      and(
        eq(organizations.discoverable, true),
        eq(organizations.kybLifecycle, 'ACTIVE'),
        ne(organizations.id, selfOrgId),
        or(ilike(organizations.name, like), ilike(organizations.legalName, like), ilike(organizations.splashHandle, `${escapeLike(q.toLowerCase())}%`), sql`lower(${organizations.registrationNumber}) = ${q.toLowerCase()}`),
      ),
    )
    .orderBy(organizations.name)
    .limit(DIRECTORY_LIMIT);
  return rows.map((r) => ({ ...r, verified: true as const }));
}

/** The payee, read again on the server at the moment a payment starts. */
export async function payeeFor(db: DirectoryDb, selfOrgId: string, payeeOrgId: string) {
  if (payeeOrgId === selfOrgId) throw new DirectoryError('That is your own company. To move money between your accounts, use Treasury.', 422);
  const [row] = await db
    .select({ orgId: organizations.id, name: organizations.name, country: organizations.addressCountry, handle: organizations.splashHandle, discoverable: organizations.discoverable, lifecycle: organizations.kybLifecycle, vaultPda: orgVaults.vaultPda })
    .from(organizations)
    .innerJoin(orgVaults, eq(orgVaults.orgId, organizations.id))
    .where(eq(organizations.id, payeeOrgId));
  if (!row || !row.discoverable || row.lifecycle !== 'ACTIVE') throw new DirectoryError('That business can’t be paid on Splash. Pay their bank instead.', 404);
  return { payeeOrgId: row.orgId, payeeName: row.name, payeeHandle: row.handle, payeeCountry: row.country, payeeVaultPda: row.vaultPda };
}
