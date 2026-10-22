/**
 * Where payment state lives (prompt 07 §5.1), behind one interface with two implementations:
 *
 *   createMemoryPaymentRepo()      the offline demo and tests; resets with the process
 *   createPostgresPaymentRepo(db)  solana_payments + solana_payment_transitions + solana_chain_calls
 *                                  (drizzle/0030); survives a restart, so a crashed worker resumes
 *
 * The rules both enforce, and the tests run against both:
 *   - every state change is ONE compare-and-set: it applies only if the stored state is one of the
 *     expected states AND (when given) the stored version matches; the version then goes up by one
 *     and a transition row is written with it. A losing racer gets StateConflictError, never a
 *     half-applied change.
 *   - the transition must be legal in the machine (payment-machine.ts).
 *   - every chain call is recorded under its idempotency key `paymentId:step` with its signature
 *     BEFORE the bytes are broadcast. Recording the same key with the same signature is a no-op;
 *     with a different signature it is refused (IdempotencyConflictError): that would be a
 *     double send.
 *   - records are stored encoded (bigint as {"$bigint": "…"}), so what comes back is a copy: a
 *     caller cannot change stored state by mutating an object it holds.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { solanaChainCalls, solanaPayments, solanaPaymentTransitions } from '../db/schema.ts';
import { assertTransition, PAYMENT_STATES, type PaymentState } from './payment-machine.ts';
import type { PaymentRecord } from './store.ts';

/* ------------------------------------------------------------------ codec */

/** JSON with bigint kept exact. */
export function encodeRecord<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v)));
}

export function decodeRecord<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === '$bigint' && typeof v.$bigint === 'string' && /^-?\d+$/.test(v.$bigint)) return BigInt(v.$bigint);
    }
    return v;
  }) as T;
}

/* ------------------------------------------------------------------ types */

export type ChainCallStatus = 'signed' | 'confirmed' | 'finalized' | 'failed' | 'expired';

export interface ChainCall {
  key: string;
  paymentId: string;
  step: string;
  status: ChainCallStatus;
  signature: string;
  lastValidBlockHeight: number | null;
  logs: string[] | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransitionRecord {
  paymentId: string;
  from: PaymentState | null;
  to: PaymentState;
  version: number;
  reason: string | null;
  at: string;
}

export class StateConflictError extends Error {
  readonly paymentId: string;
  readonly actual: { state: PaymentState; version: number } | null;
  constructor(paymentId: string, expected: string, actual: { state: PaymentState; version: number } | null) {
    super(actual ? `Payment ${paymentId} is ${actual.state} (v${actual.version}), expected ${expected}` : `Payment ${paymentId} not found`);
    this.name = 'StateConflictError';
    this.paymentId = paymentId;
    this.actual = actual;
  }
}

export class IdempotencyConflictError extends Error {
  readonly key: string;
  constructor(key: string, existing: string, attempted: string) {
    super(`Chain call ${key} already carries signature ${existing.slice(0, 12)}…; refusing a second send (${attempted.slice(0, 12)}…)`);
    this.name = 'IdempotencyConflictError';
    this.key = key;
  }
}

export interface Expect {
  from: PaymentState | readonly PaymentState[];
  /** When given, the stored version must match too. */
  version?: number;
}

export interface PaymentRepo {
  readonly kind: 'memory' | 'postgres';
  get(id: string): Promise<PaymentRecord | null>;
  listByOrg(orgId: string): Promise<PaymentRecord[]>;
  listInStates(states: readonly PaymentState[]): Promise<PaymentRecord[]>;
  /** Insert at version 1. The record's own state is the first state. */
  create(record: PaymentRecord, reason?: string): Promise<PaymentRecord>;
  /** Compare-and-set to `to`, applying `mutate` to a copy. Throws StateConflictError on a lost race. */
  transition(id: string, expect: Expect, to: PaymentState, mutate?: (draft: PaymentRecord) => void, reason?: string, now?: Date): Promise<PaymentRecord>;
  /** Compare-and-set without a state change (version still goes up). */
  update(id: string, expect: { version: number; states?: readonly PaymentState[] }, mutate: (draft: PaymentRecord) => void, now?: Date): Promise<PaymentRecord>;
  transitions(id: string): Promise<TransitionRecord[]>;
  getCall(key: string): Promise<ChainCall | null>;
  listCalls(paymentId: string): Promise<ChainCall[]>;
  /** Record a signed call before broadcast. Same key + same signature: returns the existing row. */
  recordSigned(input: { key: string; paymentId: string; step: string; signature: string; lastValidBlockHeight: number | null }, now?: Date): Promise<ChainCall>;
  updateCall(key: string, patch: { status?: ChainCallStatus; logs?: string[] | null; error?: string | null }, now?: Date): Promise<ChainCall>;
}

const froms = (e: Expect): readonly PaymentState[] => (typeof e.from === 'string' ? [e.from] : e.from);
const describe = (e: Expect) => `${froms(e).join('|')}${e.version !== undefined ? ` at v${e.version}` : ''}`;

function stamp(record: PaymentRecord, state: PaymentState, version: number, now: Date): PaymentRecord {
  return { ...record, state, version, updatedAt: now.toISOString() };
}

/* ------------------------------------------------------------------ memory */

export function createMemoryPaymentRepo(): PaymentRepo {
  const rows = new Map<string, { orgId: string; state: PaymentState; version: number; record: unknown; createdAt: string }>();
  const history: TransitionRecord[] = [];
  const calls = new Map<string, ChainCall>();

  const read = (id: string) => {
    const row = rows.get(id);
    return row ? decodeRecord<PaymentRecord>(row.record) : null;
  };

  return {
    kind: 'memory',
    async get(id) {
      return read(id);
    },
    async listByOrg(orgId) {
      return [...rows.entries()].filter(([, r]) => r.orgId === orgId).sort((a, b) => (a[1].createdAt < b[1].createdAt ? 1 : -1)).map(([id]) => read(id)!);
    },
    async listInStates(states) {
      return [...rows.entries()].filter(([, r]) => states.includes(r.state)).map(([id]) => read(id)!);
    },
    async create(record, reason) {
      if (rows.has(record.id)) throw new StateConflictError(record.id, 'absent', { state: rows.get(record.id)!.state, version: rows.get(record.id)!.version });
      const now = new Date(record.updatedAt ?? record.createdAt);
      const stored = stamp(record, record.state, 1, now);
      rows.set(record.id, { orgId: record.orgId, state: record.state, version: 1, record: encodeRecord(stored), createdAt: record.createdAt });
      history.push({ paymentId: record.id, from: null, to: record.state, version: 1, reason: reason ?? null, at: now.toISOString() });
      return read(record.id)!;
    },
    async transition(id, expect, to, mutate, reason, now = new Date()) {
      const row = rows.get(id);
      if (!row || !froms(expect).includes(row.state) || (expect.version !== undefined && expect.version !== row.version)) {
        throw new StateConflictError(id, describe(expect), row ? { state: row.state, version: row.version } : null);
      }
      assertTransition(row.state, to);
      const draft = decodeRecord<PaymentRecord>(row.record);
      mutate?.(draft);
      const version = row.version + 1;
      const stored = stamp(draft, to, version, now);
      // Check-then-write with no await in between: atomic in one process.
      rows.set(id, { ...row, state: to, version, record: encodeRecord(stored) });
      history.push({ paymentId: id, from: row.state, to, version, reason: reason ?? null, at: now.toISOString() });
      return read(id)!;
    },
    async update(id, expect, mutate, now = new Date()) {
      const row = rows.get(id);
      if (!row || row.version !== expect.version || (expect.states && !expect.states.includes(row.state))) {
        throw new StateConflictError(id, `v${expect.version}`, row ? { state: row.state, version: row.version } : null);
      }
      const draft = decodeRecord<PaymentRecord>(row.record);
      mutate(draft);
      const version = row.version + 1;
      rows.set(id, { ...row, version, record: encodeRecord(stamp(draft, row.state, version, now)) });
      return read(id)!;
    },
    async transitions(id) {
      return history.filter((h) => h.paymentId === id).map((h) => ({ ...h }));
    },
    async getCall(key) {
      const c = calls.get(key);
      return c ? { ...c } : null;
    },
    async listCalls(paymentId) {
      return [...calls.values()].filter((c) => c.paymentId === paymentId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map((c) => ({ ...c }));
    },
    async recordSigned(input, now = new Date()) {
      if (!rows.has(input.paymentId)) throw new StateConflictError(input.paymentId, 'present', null);
      if (input.key !== `${input.paymentId}:${input.step}`) throw new Error('chain call key must be paymentId:step');
      const existing = calls.get(input.key);
      if (existing) {
        if (existing.signature !== input.signature) throw new IdempotencyConflictError(input.key, existing.signature, input.signature);
        return { ...existing };
      }
      if ([...calls.values()].some((c) => c.signature === input.signature)) throw new IdempotencyConflictError(input.key, input.signature, input.signature);
      const at = now.toISOString();
      const call: ChainCall = { ...input, status: 'signed', logs: null, error: null, createdAt: at, updatedAt: at };
      calls.set(input.key, call);
      return { ...call };
    },
    async updateCall(key, patch, now = new Date()) {
      const c = calls.get(key);
      if (!c) throw new Error(`no chain call ${key}`);
      const next: ChainCall = { ...c, ...patch, updatedAt: now.toISOString() };
      calls.set(key, next);
      return { ...next };
    },
  };
}

/* ------------------------------------------------------------------ postgres */

// Structural: node-postgres in the app, PGlite in the tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, any, any>;

function rowToCall(r: typeof solanaChainCalls.$inferSelect): ChainCall {
  return {
    key: r.key,
    paymentId: r.paymentId,
    step: r.step,
    status: r.status as ChainCallStatus,
    signature: r.signature,
    lastValidBlockHeight: r.lastValidBlockHeight === null ? null : Number(r.lastValidBlockHeight),
    logs: (r.logs as string[] | null) ?? null,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function createPostgresPaymentRepo(db: Db): PaymentRepo {
  const read = async (id: string, executor: Db = db) => {
    const [row] = await executor.select().from(solanaPayments).where(eq(solanaPayments.id, id)).limit(1);
    return row ?? null;
  };

  async function cas(
    id: string,
    check: (row: typeof solanaPayments.$inferSelect) => boolean,
    expected: string,
    to: PaymentState | null,
    mutate: ((draft: PaymentRecord) => void) | undefined,
    reason: string | undefined,
    now: Date,
  ): Promise<PaymentRecord> {
    return db.transaction(async (tx) => {
      const row = await read(id, tx as unknown as Db);
      if (!row || !check(row)) {
        throw new StateConflictError(id, expected, row ? { state: row.state as PaymentState, version: row.version } : null);
      }
      const from = row.state as PaymentState;
      const target = to ?? from;
      if (to) assertTransition(from, to);
      const draft = decodeRecord<PaymentRecord>(row.record);
      mutate?.(draft);
      const version = row.version + 1;
      const stored = stamp(draft, target, version, now);
      // The compare-and-set itself: state AND version must still be what we read.
      const updated = await tx
        .update(solanaPayments)
        .set({ state: target, version, record: encodeRecord(stored), updatedAt: now })
        .where(and(eq(solanaPayments.id, id), eq(solanaPayments.state, from), eq(solanaPayments.version, row.version)))
        .returning({ id: solanaPayments.id });
      if (updated.length !== 1) {
        const current = await read(id, tx as unknown as Db);
        throw new StateConflictError(id, expected, current ? { state: current.state as PaymentState, version: current.version } : null);
      }
      if (to) {
        await tx.insert(solanaPaymentTransitions).values({ paymentId: id, fromState: from, toState: to, version, reason: reason ?? null, at: now });
      }
      return stored;
    });
  }

  return {
    kind: 'postgres',
    async get(id) {
      const row = await read(id);
      return row ? decodeRecord<PaymentRecord>(row.record) : null;
    },
    async listByOrg(orgId) {
      const rows = await db.select().from(solanaPayments).where(eq(solanaPayments.orgId, orgId)).orderBy(sql`${solanaPayments.createdAt} desc`);
      return rows.map((r) => decodeRecord<PaymentRecord>(r.record));
    },
    async listInStates(states) {
      if (states.length === 0) return [];
      const rows = await db.select().from(solanaPayments).where(inArray(solanaPayments.state, [...states]));
      return rows.map((r) => decodeRecord<PaymentRecord>(r.record));
    },
    async create(record, reason) {
      if (!PAYMENT_STATES.includes(record.state)) throw new Error(`unknown state ${record.state}`);
      const now = new Date(record.updatedAt ?? record.createdAt);
      const stored = stamp(record, record.state, 1, now);
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(solanaPayments)
          .values({ id: record.id, orgId: record.orgId, state: record.state, version: 1, record: encodeRecord(stored), createdAt: new Date(record.createdAt), updatedAt: now })
          .onConflictDoNothing()
          .returning({ id: solanaPayments.id });
        if (inserted.length !== 1) {
          const existing = await read(record.id, tx as unknown as Db);
          throw new StateConflictError(record.id, 'absent', existing ? { state: existing.state as PaymentState, version: existing.version } : null);
        }
        await tx.insert(solanaPaymentTransitions).values({ paymentId: record.id, fromState: null, toState: record.state, version: 1, reason: reason ?? null, at: now });
      });
      return stored;
    },
    async transition(id, expect, to, mutate, reason, now = new Date()) {
      return cas(id, (r) => froms(expect).includes(r.state as PaymentState) && (expect.version === undefined || expect.version === r.version), describe(expect), to, mutate, reason, now);
    },
    async update(id, expect, mutate, now = new Date()) {
      return cas(id, (r) => r.version === expect.version && (!expect.states || expect.states.includes(r.state as PaymentState)), `v${expect.version}`, null, mutate, undefined, now);
    },
    async transitions(id) {
      const rows = await db.select().from(solanaPaymentTransitions).where(eq(solanaPaymentTransitions.paymentId, id)).orderBy(asc(solanaPaymentTransitions.version));
      return rows.map((r) => ({ paymentId: r.paymentId, from: (r.fromState as PaymentState | null) ?? null, to: r.toState as PaymentState, version: r.version, reason: r.reason, at: r.at.toISOString() }));
    },
    async getCall(key) {
      const [row] = await db.select().from(solanaChainCalls).where(eq(solanaChainCalls.key, key)).limit(1);
      return row ? rowToCall(row) : null;
    },
    async listCalls(paymentId) {
      const rows = await db.select().from(solanaChainCalls).where(eq(solanaChainCalls.paymentId, paymentId)).orderBy(asc(solanaChainCalls.createdAt));
      return rows.map(rowToCall);
    },
    async recordSigned(input, now = new Date()) {
      if (input.key !== `${input.paymentId}:${input.step}`) throw new Error('chain call key must be paymentId:step');
      const inserted = await db
        .insert(solanaChainCalls)
        .values({
          key: input.key,
          paymentId: input.paymentId,
          step: input.step,
          status: 'signed',
          signature: input.signature,
          lastValidBlockHeight: input.lastValidBlockHeight === null ? null : BigInt(input.lastValidBlockHeight),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 1) return rowToCall(inserted[0]!);
      const existing = await this.getCall(input.key);
      if (!existing) throw new IdempotencyConflictError(input.key, input.signature, input.signature); // signature used under another key
      if (existing.signature !== input.signature) throw new IdempotencyConflictError(input.key, existing.signature, input.signature);
      return existing;
    },
    async updateCall(key, patch, now = new Date()) {
      const [row] = await db
        .update(solanaChainCalls)
        .set({ ...(patch.status ? { status: patch.status } : {}), ...(patch.logs !== undefined ? { logs: patch.logs } : {}), ...(patch.error !== undefined ? { error: patch.error } : {}), updatedAt: now })
        .where(eq(solanaChainCalls.key, key))
        .returning();
      if (!row) throw new Error(`no chain call ${key}`);
      return rowToCall(row);
    },
  };
}
