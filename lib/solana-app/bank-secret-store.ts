import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { bankAccountReveals, bankAccountSecrets } from '../db/schema.ts';

/**
 * The one store for full bank account numbers (prompt 10 Phase S §S.1.1): `bank_account_secrets`, plus
 * `bank_account_reveals`, the log of every attempt to see one. Two adapters with the same behaviour:
 * Postgres (when DATABASE_URL is set) and memory (the offline demo and tests; nothing on disk).
 *
 * Only this module touches the two tables (scripts/check-store-access.mjs). Every read names the
 * company; the one read across companies is the shred job's, and it is named for it.
 *
 * What is stored is already sealed (lib/server/pii-vault.ts): ciphertext, nonce and the wrapped data
 * key. Shredding deletes all three; last4, the fingerprint and the dates stay (7 years, with the
 * payment records).
 */

export interface BankSecret {
  id: string;
  orgId: string;
  beneficiaryId: string;
  ciphertext: Uint8Array | null;
  nonce: Uint8Array | null;
  wrappedDataKey: Uint8Array | null;
  keyId: string;
  last4: string;
  fingerprint: string;
  createdAt: Date;
  replacedAt: Date | null;
  shredAfter: Date | null;
  shreddedAt: Date | null;
}

export type NewBankSecret = Pick<BankSecret, 'orgId' | 'beneficiaryId' | 'keyId' | 'last4' | 'fingerprint'> & {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  wrappedDataKey: Uint8Array;
};

/** One attempt to see a number: a challenge asked for, a number shown, or a refusal (and why). */
export interface RevealLogEntry {
  id: string;
  orgId: string;
  beneficiaryId: string;
  secretId: string | null;
  userId: string;
  result: 'challenged' | 'revealed' | 'refused';
  reason: string;
  at: Date;
}

export interface SecretStore {
  readonly kind: 'memory' | 'postgres';
  /** Store a recipient's new number as current; the one it replaces (if any) gets `replacedAt`. One step. */
  putCurrent(rec: NewBankSecret, at: Date): Promise<{ secret: BankSecret; replaced: BankSecret | null }>;
  get(orgId: string, id: string): Promise<BankSecret | null>;
  current(orgId: string, beneficiaryId: string): Promise<BankSecret | null>;
  /** Every record for the recipient, newest first. */
  history(orgId: string, beneficiaryId: string): Promise<BankSecret[]>;
  findByFingerprint(orgId: string, fingerprint: string): Promise<BankSecret[]>;
  /** A removed recipient: every record not yet shredded is due at `after`. Returns how many. */
  scheduleShred(orgId: string, beneficiaryId: string, after: Date): Promise<number>;
  /** The shred job's read, across companies: due and not yet shredded. */
  dueForShredAcrossCompanies(now: Date): Promise<BankSecret[]>;
  /** Delete the ciphertext, nonce and wrapped key if due and not already done. True when it did. */
  shred(id: string, now: Date): Promise<boolean>;
  /** Key rotation: a record's data key wrapped again (the number itself never decrypted). */
  rewrap(orgId: string, id: string, wrappedDataKey: Uint8Array, keyId: string): Promise<void>;
  logReveal(entry: Omit<RevealLogEntry, 'id'>): Promise<RevealLogEntry>;
  reveals(orgId: string): Promise<RevealLogEntry[]>;
}

const copy = (b: Uint8Array | null) => (b ? new Uint8Array(b) : null);
const clone = (s: BankSecret): BankSecret => ({ ...s, ciphertext: copy(s.ciphertext), nonce: copy(s.nonce), wrappedDataKey: copy(s.wrappedDataKey) });

export function createMemorySecretStore(): SecretStore {
  const rows = new Map<string, BankSecret>();
  const log: RevealLogEntry[] = [];
  const mine = (orgId: string) => [...rows.values()].filter((r) => r.orgId === orgId);
  const newestFirst = (a: BankSecret, b: BankSecret) => b.createdAt.getTime() - a.createdAt.getTime();
  return {
    kind: 'memory',
    async putCurrent(rec, at) {
      const old = mine(rec.orgId).find((r) => r.beneficiaryId === rec.beneficiaryId && !r.replacedAt) ?? null;
      if (old) old.replacedAt = at;
      const secret: BankSecret = { ...rec, id: `bks_${randomUUID()}`, ciphertext: copy(rec.ciphertext), nonce: copy(rec.nonce), wrappedDataKey: copy(rec.wrappedDataKey), createdAt: at, replacedAt: null, shredAfter: null, shreddedAt: null };
      rows.set(secret.id, secret);
      return { secret: clone(secret), replaced: old ? clone(old) : null };
    },
    async get(orgId, id) {
      const r = rows.get(id);
      return r && r.orgId === orgId ? clone(r) : null;
    },
    async current(orgId, beneficiaryId) {
      const r = mine(orgId).find((x) => x.beneficiaryId === beneficiaryId && !x.replacedAt);
      return r ? clone(r) : null;
    },
    async history(orgId, beneficiaryId) {
      return mine(orgId).filter((x) => x.beneficiaryId === beneficiaryId).sort(newestFirst).map(clone);
    },
    async findByFingerprint(orgId, fingerprint) {
      return mine(orgId).filter((x) => x.fingerprint === fingerprint).sort(newestFirst).map(clone);
    },
    async scheduleShred(orgId, beneficiaryId, after) {
      let n = 0;
      for (const r of mine(orgId)) {
        if (r.beneficiaryId !== beneficiaryId || r.shreddedAt) continue;
        r.shredAfter = after;
        n++;
      }
      return n;
    },
    async dueForShredAcrossCompanies(now) {
      return [...rows.values()].filter((r) => !r.shreddedAt && r.shredAfter && r.shredAfter.getTime() <= now.getTime()).map(clone);
    },
    async shred(id, now) {
      const r = rows.get(id);
      if (!r || r.shreddedAt || !r.shredAfter || r.shredAfter.getTime() > now.getTime()) return false;
      r.ciphertext = null;
      r.nonce = null;
      r.wrappedDataKey = null;
      r.shreddedAt = now;
      return true;
    },
    async rewrap(orgId, id, wrappedDataKey, keyId) {
      const r = rows.get(id);
      if (!r || r.orgId !== orgId || r.shreddedAt) return;
      r.wrappedDataKey = copy(wrappedDataKey);
      r.keyId = keyId;
    },
    async logReveal(entry) {
      const row = { ...entry, id: `bkr_${randomUUID()}` };
      log.push(row);
      return { ...row };
    },
    async reveals(orgId) {
      return log.filter((e) => e.orgId === orgId).map((e) => ({ ...e }));
    },
  };
}

/* ── Postgres ─────────────────────────────────────────────────────────── */

const b64 = (b: Uint8Array | null) => (b ? Buffer.from(b).toString('base64') : null);
const unb64 = (s: string | null) => (s ? new Uint8Array(Buffer.from(s, 'base64')) : null);

type Row = typeof bankAccountSecrets.$inferSelect;
const fromRow = (r: Row): BankSecret => ({
  id: r.id,
  orgId: r.orgId,
  beneficiaryId: r.beneficiaryId,
  ciphertext: unb64(r.ciphertext),
  nonce: unb64(r.nonce),
  wrappedDataKey: unb64(r.wrappedDataKey),
  keyId: r.keyId,
  last4: r.last4,
  fingerprint: r.fingerprint,
  createdAt: r.createdAt,
  replacedAt: r.replacedAt,
  shredAfter: r.shredAfter,
  shreddedAt: r.shreddedAt,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPostgresSecretStore(db: PgDatabase<any, any, any>): SecretStore {
  const t = bankAccountSecrets;
  return {
    kind: 'postgres',
    async putCurrent(rec, at) {
      return await db.transaction(async (tx) => {
        const [replaced] = await tx
          .update(t)
          .set({ replacedAt: at })
          .where(and(eq(t.orgId, rec.orgId), eq(t.beneficiaryId, rec.beneficiaryId), isNull(t.replacedAt)))
          .returning();
        const [row] = await tx
          .insert(t)
          .values({ id: `bks_${randomUUID()}`, orgId: rec.orgId, beneficiaryId: rec.beneficiaryId, ciphertext: b64(rec.ciphertext), nonce: b64(rec.nonce), wrappedDataKey: b64(rec.wrappedDataKey), keyId: rec.keyId, last4: rec.last4, fingerprint: rec.fingerprint, createdAt: at })
          .returning();
        return { secret: fromRow(row), replaced: replaced ? fromRow(replaced) : null };
      });
    },
    async get(orgId, id) {
      const [r] = await db.select().from(t).where(and(eq(t.orgId, orgId), eq(t.id, id)));
      return r ? fromRow(r) : null;
    },
    async current(orgId, beneficiaryId) {
      const [r] = await db.select().from(t).where(and(eq(t.orgId, orgId), eq(t.beneficiaryId, beneficiaryId), isNull(t.replacedAt)));
      return r ? fromRow(r) : null;
    },
    async history(orgId, beneficiaryId) {
      const rows = await db.select().from(t).where(and(eq(t.orgId, orgId), eq(t.beneficiaryId, beneficiaryId))).orderBy(desc(t.createdAt));
      return rows.map(fromRow);
    },
    async findByFingerprint(orgId, fingerprint) {
      const rows = await db.select().from(t).where(and(eq(t.orgId, orgId), eq(t.fingerprint, fingerprint))).orderBy(desc(t.createdAt));
      return rows.map(fromRow);
    },
    async scheduleShred(orgId, beneficiaryId, after) {
      const rows = await db
        .update(t)
        .set({ shredAfter: after })
        .where(and(eq(t.orgId, orgId), eq(t.beneficiaryId, beneficiaryId), isNull(t.shreddedAt)))
        .returning({ id: t.id });
      return rows.length;
    },
    async dueForShredAcrossCompanies(now) {
      const rows = await db.select().from(t).where(and(isNull(t.shreddedAt), lte(t.shredAfter, now)));
      return rows.map(fromRow);
    },
    async shred(id, now) {
      const rows = await db
        .update(t)
        .set({ ciphertext: null, nonce: null, wrappedDataKey: null, shreddedAt: now })
        .where(and(eq(t.id, id), isNull(t.shreddedAt), lte(t.shredAfter, now)))
        .returning({ id: t.id });
      return rows.length === 1;
    },
    async rewrap(orgId, id, wrappedDataKey, keyId) {
      await db
        .update(t)
        .set({ wrappedDataKey: b64(wrappedDataKey), keyId })
        .where(and(eq(t.orgId, orgId), eq(t.id, id), isNull(t.shreddedAt)));
    },
    async logReveal(entry) {
      const [row] = await db.insert(bankAccountReveals).values({ ...entry, id: `bkr_${randomUUID()}` }).returning();
      return { ...row, result: row.result as RevealLogEntry['result'] };
    },
    async reveals(orgId) {
      const rows = await db.select().from(bankAccountReveals).where(eq(bankAccountReveals.orgId, orgId)).orderBy(sql`${bankAccountReveals.at} asc`);
      return rows.map((row) => ({ ...row, result: row.result as RevealLogEntry['result'] }));
    },
  };
}
