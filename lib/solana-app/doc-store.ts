/**
 * The Solana app's per-company documents (drizzle/0031): the company record, its invoices, its
 * evidence, the receipt share links it minted and its batch payouts. Two implementations behind one interface, like
 * the payment repository:
 *
 *   createMemoryDocStore()      the offline demo and tests: the in-process store IS the truth, so
 *                               loading finds nothing new and saving keeps nothing
 *   createPostgresDocStore(db)  solana_documents: a company's documents come back after a restart
 *
 * Documents are read whole and written whole (last writer wins). That is right for records only
 * the company itself edits. Anything that moves money is a payment and goes through the state
 * machine's compare-and-set instead (payment-repo.ts), never through here.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { solanaDocuments } from '../db/schema.ts';
import { decodeRecord, encodeRecord } from './payment-repo.ts';
import type { BatchRecord } from './batch-service.ts';
import type { EvidenceRecord, InvoiceRecord, OrgRecord, PayLinkRecord, PaymentRequestRecord } from './store.ts';

/** A receipt share link: who minted it, for which receipt. The token is the document id. */
export interface ShareRecord {
  token: string;
  receiptId: string;
  orgId: string;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
}

/** 'request' and 'paylink' (drizzle/0036): a company's payment requests, and the links someone else pays one by. */
export type DocKind = 'org' | 'invoice' | 'evidence' | 'share' | 'batch' | 'request' | 'paylink';

export interface Doc {
  kind: DocKind;
  id: string;
  orgId: string;
  body: unknown;
}

export interface OrgDocuments {
  org: OrgRecord | null;
  invoices: InvoiceRecord[];
  evidence: EvidenceRecord[];
  shares: ShareRecord[];
  batches: BatchRecord[];
  requests: PaymentRequestRecord[];
  paylinks: PayLinkRecord[];
}

export interface DocStore {
  /** Everything one company has, decoded. Empty when nothing was saved. */
  loadOrg(orgId: string): Promise<OrgDocuments>;
  /** Which company a document belongs to, for requests that arrive with only its id (a share link). */
  ownerOf(kind: DocKind, id: string): Promise<string | null>;
  save(docs: Doc[]): Promise<void>;
  /** Every company with a saved record, for the admin console. */
  listOrgIds(): Promise<string[]>;
}

export function createMemoryDocStore(): DocStore {
  return {
    async loadOrg() {
      return { org: null, invoices: [], evidence: [], shares: [], batches: [], requests: [], paylinks: [] };
    },
    async ownerOf() {
      return null;
    },
    async save() {},
    async listOrgIds() {
      return [];
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, any, any>;

export function createPostgresDocStore(db: Db): DocStore {
  return {
    async loadOrg(orgId) {
      const rows = await db.select().from(solanaDocuments).where(eq(solanaDocuments.orgId, orgId));
      const of = <T>(kind: DocKind) => rows.filter((r) => r.kind === kind).map((r) => decodeRecord<T>(r.body));
      return { org: of<OrgRecord>('org')[0] ?? null, invoices: of<InvoiceRecord>('invoice'), evidence: of<EvidenceRecord>('evidence'), shares: of<ShareRecord>('share'), batches: of<BatchRecord>('batch'), requests: of<PaymentRequestRecord>('request'), paylinks: of<PayLinkRecord>('paylink') };
    },
    async ownerOf(kind, id) {
      const [row] = await db.select({ orgId: solanaDocuments.orgId }).from(solanaDocuments).where(and(eq(solanaDocuments.kind, kind), eq(solanaDocuments.id, id))).limit(1);
      return row?.orgId ?? null;
    },
    async save(docs) {
      if (docs.length === 0) return;
      await db
        .insert(solanaDocuments)
        .values(docs.map((d) => ({ kind: d.kind, id: d.id, orgId: d.orgId, body: encodeRecord(d.body) })))
        .onConflictDoUpdate({ target: [solanaDocuments.kind, solanaDocuments.id], set: { body: sql`excluded.body`, updatedAt: sql`now()` } });
    },
    async listOrgIds() {
      const rows = await db.select({ orgId: solanaDocuments.orgId }).from(solanaDocuments).where(eq(solanaDocuments.kind, 'org'));
      return [...new Set(rows.map((r) => r.orgId))];
    },
  };
}

/** Test seam: what a Postgres store holds for one company, by kind. */
export async function countDocuments(db: Db, orgId: string, kinds: DocKind[]): Promise<number> {
  const rows = await db.select({ id: solanaDocuments.id }).from(solanaDocuments).where(and(eq(solanaDocuments.orgId, orgId), inArray(solanaDocuments.kind, kinds)));
  return rows.length;
}
