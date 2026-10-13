import 'server-only';

import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import { kybCases } from '@/lib/db/schema';

/**
 * Postgres access for KYB review cases.
 *
 * Same shape as the other repositories: this module knows the table, the store
 * above it knows the rules, and nothing else touches either. Every read that a
 * customer can reach takes an `orgId`; the two that deliberately cross tenants
 * are named `*ForStaff` so a call site cannot use one by accident.
 */

export type KybCaseRow = {
  id: string;
  orgId: string;
  businessName: string;
  registrationNumber: string;
  state: string;
  riskTier: string;
  corridorAccess: string;
  assignedTo: string | null;
  sumsubApplicantId: string | null;
  documents: unknown;
  reviewNotes: string | null;
  decisionReason: string | null;
  auditTrail: unknown;
  submittedAt: Date;
  updatedAt: Date;
};

type Db = {
  select: (...args: never[]) => never;
  insert: (...args: never[]) => never;
  update: (...args: never[]) => never;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyDb = any;

/**
 * Write a whole row, documents and audit trail included.
 *
 * For seeding a case in one go (the tests do). The store does not call it: a
 * whole-row write built from an earlier read puts back the documents and the
 * trail as they were at that read, erasing anything appended in between.
 * Changes to a live case go through `upsertSubmission` and `amendForStaff`.
 */
export async function insertOrUpdate(db: Db, row: {
  id: string;
  orgId: string;
  businessName: string;
  registrationNumber: string;
  state: string;
  riskTier: string;
  corridorAccess: string;
  assignedTo: string | null;
  sumsubApplicantId: string | null;
  documents: unknown;
  reviewNotes: string | null;
  decisionReason: string | null;
  auditTrail: unknown;
  submittedAt: Date;
  updatedAt: Date;
}): Promise<void> {
  await (db as AnyDb)
    .insert(kybCases)
    .values(row)
    .onConflictDoUpdate({
      target: kybCases.id,
      set: {
        businessName: row.businessName,
        registrationNumber: row.registrationNumber,
        state: row.state,
        riskTier: row.riskTier,
        corridorAccess: row.corridorAccess,
        assignedTo: row.assignedTo,
        sumsubApplicantId: row.sumsubApplicantId,
        documents: row.documents,
        reviewNotes: row.reviewNotes,
        decisionReason: row.decisionReason,
        auditTrail: row.auditTrail,
        updatedAt: row.updatedAt,
      },
    });
}

/**
 * A business submitting documents: the first time, a new case; every time
 * after, the same case.
 *
 * Keyed on (org, registration number), which is what makes it one company's
 * case, rather than on the id. The upload route mints a fresh id per request,
 * so an id-keyed upsert inserted a second row on resubmission and
 * `kyb_cases_org_registration_unique` turned it into a 500.
 *
 * On conflict the existing row keeps its id, its first `submitted_at`, its
 * reviewer and their notes. The new documents and the new audit event are
 * appended in SQL, not read-modified-written, so two submissions racing each
 * other both land, and nothing already in the trail can be dropped by this
 * write. State goes back to SUBMITTED with risk and corridor access reset:
 * new documents are a new review.
 */
export async function upsertSubmission(db: Db, row: KybCaseRow): Promise<KybCaseRow> {
  const rows = await (db as AnyDb)
    .insert(kybCases)
    .values(row)
    .onConflictDoUpdate({
      target: [kybCases.orgId, kybCases.registrationNumber],
      set: {
        businessName: row.businessName,
        state: row.state,
        riskTier: row.riskTier,
        corridorAccess: row.corridorAccess,
        sumsubApplicantId: sql`coalesce(excluded.sumsub_applicant_id, ${kybCases.sumsubApplicantId})`,
        documents: sql`${kybCases.documents} || excluded.documents`,
        auditTrail: sql`${kybCases.auditTrail} || excluded.audit_trail`,
        updatedAt: row.updatedAt,
      },
    })
    .returning();
  return rows[0] as KybCaseRow;
}

/** What a staff-side write may change. Never the documents, and never the
 *  audit trail except by appending one event. */
export type KybCaseAmendment = Partial<
  Pick<KybCaseRow, 'state' | 'riskTier' | 'corridorAccess' | 'assignedTo' | 'sumsubApplicantId' | 'reviewNotes' | 'decisionReason'>
> & { updatedAt: Date };

/**
 * A reviewer's decision or a provider link: set these fields on one case and
 * append one audit event, in one statement.
 *
 * Only the named columns are written. A review used to read the case, rebuild
 * the whole record and write it back, so a resubmission that landed between
 * the read and the write lost its documents and its audit event. The append
 * here reads `audit_trail` as it is when the row is updated, not as it was when
 * someone opened the case. No row, no write: returns null.
 *
 * Cross-tenant by id, like `findForStaff`; `amendForOrg` is the customer form.
 */
export async function amendForStaff(
  db: Db,
  id: string,
  changes: KybCaseAmendment,
  auditEvent: unknown,
): Promise<KybCaseRow | null> {
  return amendWhere(db, eq(kybCases.id, id), changes, auditEvent);
}

/** The same write, only if the case belongs to this org. */
export async function amendForOrg(
  db: Db,
  orgId: string,
  id: string,
  changes: KybCaseAmendment,
  auditEvent: unknown,
): Promise<KybCaseRow | null> {
  return amendWhere(db, and(eq(kybCases.id, id), eq(kybCases.orgId, orgId)), changes, auditEvent);
}

async function amendWhere(
  db: Db,
  where: SQL | undefined,
  changes: KybCaseAmendment,
  auditEvent: unknown,
): Promise<KybCaseRow | null> {
  const rows = await (db as AnyDb)
    .update(kybCases)
    .set({
      ...changes,
      auditTrail: sql`${kybCases.auditTrail} || ${JSON.stringify([auditEvent])}::jsonb`,
    })
    .where(where)
    .returning();
  return (rows[0] as KybCaseRow) ?? null;
}

/** This org's case for one registration number, if it has filed one. */
export async function findByRegistrationForOrg(
  db: Db,
  orgId: string,
  registrationNumber: string,
): Promise<KybCaseRow | null> {
  const rows = await (db as AnyDb)
    .select()
    .from(kybCases)
    .where(and(eq(kybCases.orgId, orgId), eq(kybCases.registrationNumber, registrationNumber)))
    .limit(1);
  return (rows[0] as KybCaseRow) ?? null;
}

/** One case, only if it belongs to this org. */
export async function findForOrg(db: Db, orgId: string, id: string): Promise<KybCaseRow | null> {
  const rows = await (db as AnyDb)
    .select()
    .from(kybCases)
    .where(and(eq(kybCases.id, id), eq(kybCases.orgId, orgId)))
    .limit(1);
  return (rows[0] as KybCaseRow) ?? null;
}

/** This org's cases, newest first. */
export async function listForOrg(db: Db, orgId: string): Promise<KybCaseRow[]> {
  return (await (db as AnyDb)
    .select()
    .from(kybCases)
    .where(eq(kybCases.orgId, orgId))
    .orderBy(desc(kybCases.updatedAt))) as KybCaseRow[];
}

/** Compliance staff review every tenant's cases; that is the job. */
export async function listAllForStaff(db: Db, limit = 500): Promise<KybCaseRow[]> {
  return (await (db as AnyDb)
    .select()
    .from(kybCases)
    .orderBy(desc(kybCases.updatedAt))
    .limit(limit)) as KybCaseRow[];
}

export async function findForStaff(db: Db, id: string): Promise<KybCaseRow | null> {
  const rows = await (db as AnyDb).select().from(kybCases).where(eq(kybCases.id, id)).limit(1);
  return (rows[0] as KybCaseRow) ?? null;
}
