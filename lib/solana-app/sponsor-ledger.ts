/**
 * The per-org daily cap on sponsored transactions (prompt 07 §5.6), enforced server-side BEFORE
 * Kora is asked. Kora keeps its own counter too (kora.toml usage_limit); this is Splash's.
 *
 * `reserve` is one atomic step: in Postgres an upsert whose update only applies while the count is
 * under the cap, so two workers racing for the last slot cannot both get it. A send refused before
 * the fee payer signs gives its slot back with `release`.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { solanaSponsorUsage } from '../db/schema.ts';

export interface SponsorLedger {
  readonly kind: 'memory' | 'postgres';
  /** Take one slot for (org, UTC day) if fewer than `cap` are taken. */
  reserve(orgId: string, day: string, cap: number): Promise<{ ok: boolean; count: number }>;
  release(orgId: string, day: string): Promise<void>;
  count(orgId: string, day: string): Promise<number>;
}

export function createMemorySponsorLedger(): SponsorLedger {
  const counts = new Map<string, number>();
  const key = (o: string, d: string) => `${o}|${d}`;
  return {
    kind: 'memory',
    async reserve(orgId, day, cap) {
      const k = key(orgId, day);
      const now = counts.get(k) ?? 0;
      if (now >= cap) return { ok: false, count: now };
      counts.set(k, now + 1);
      return { ok: true, count: now + 1 };
    },
    async release(orgId, day) {
      const k = key(orgId, day);
      counts.set(k, Math.max(0, (counts.get(k) ?? 0) - 1));
    },
    async count(orgId, day) {
      return counts.get(key(orgId, day)) ?? 0;
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, any, any>;

export function createPostgresSponsorLedger(db: Db): SponsorLedger {
  const t = solanaSponsorUsage;
  return {
    kind: 'postgres',
    async reserve(orgId, day, cap) {
      if (cap <= 0) return { ok: false, count: await this.count(orgId, day) };
      const rows = await db
        .insert(t)
        .values({ orgId, day, count: 1 })
        .onConflictDoUpdate({ target: [t.orgId, t.day], set: { count: sql`${t.count} + 1`, updatedAt: new Date() }, setWhere: sql`${t.count} < ${cap}` })
        .returning({ count: t.count });
      if (rows.length === 1) return { ok: true, count: rows[0]!.count };
      return { ok: false, count: await this.count(orgId, day) };
    },
    async release(orgId, day) {
      await db.update(t).set({ count: sql`greatest(${t.count} - 1, 0)`, updatedAt: new Date() }).where(and(eq(t.orgId, orgId), eq(t.day, day)));
    },
    async count(orgId, day) {
      const [row] = await db.select({ count: t.count }).from(t).where(and(eq(t.orgId, orgId), eq(t.day, day))).limit(1);
      return row?.count ?? 0;
    },
  };
}
