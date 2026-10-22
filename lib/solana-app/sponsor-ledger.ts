/**
 * The per-org daily cap on sponsored transactions (prompt 07 §5.6), enforced server-side BEFORE
 * Kora is asked. Kora keeps its own counter too (kora.toml usage_limit); this is Splash's.
 *
 * `reserve` is one atomic step: in Postgres an upsert whose update only applies while the count is
 * under the cap, so two workers racing for the last slot cannot both get it. A send refused before
 * the fee payer signs gives its slot back with `release`.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { solanaSponsorUsage } from '../db/schema.ts';

/** One company's sponsored sends on one UTC day: how many, and what the fee payer paid for them. */
export interface SponsorDay {
  orgId: string;
  day: string;
  count: number;
  feeLamports: bigint;
  rentLamports: bigint;
}

export interface SponsorLedger {
  readonly kind: 'memory' | 'postgres';
  /** Take one slot for (org, UTC day) if fewer than `cap` are taken. */
  reserve(orgId: string, day: string, cap: number): Promise<{ ok: boolean; count: number }>;
  release(orgId: string, day: string): Promise<void>;
  count(orgId: string, day: string): Promise<number>;
  /** Add what one landed send cost the fee payer (lib/solana/kora.ts sponsoredFeeLamports, sponsoredRentLamports). */
  addSpend(orgId: string, day: string, cost: { feeLamports: bigint; rentLamports: bigint }): Promise<void>;
  /** Every (company, day) from `fromDay` on, for the admin console. */
  list(fromDay: string): Promise<SponsorDay[]>;
}

export function createMemorySponsorLedger(): SponsorLedger {
  const counts = new Map<string, number>();
  const spend = new Map<string, { feeLamports: bigint; rentLamports: bigint }>();
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
    async addSpend(orgId, day, cost) {
      const k = key(orgId, day);
      const now = spend.get(k) ?? { feeLamports: 0n, rentLamports: 0n };
      spend.set(k, { feeLamports: now.feeLamports + cost.feeLamports, rentLamports: now.rentLamports + cost.rentLamports });
    },
    async list(fromDay) {
      const keys = new Set([...counts.keys(), ...spend.keys()]);
      return [...keys]
        .map((k) => {
          const [orgId, day] = k.split('|') as [string, string];
          const s = spend.get(k) ?? { feeLamports: 0n, rentLamports: 0n };
          return { orgId, day, count: counts.get(k) ?? 0, ...s };
        })
        .filter((r) => r.day >= fromDay);
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
    async addSpend(orgId, day, cost) {
      // The send already took its slot (reserve), so the row exists; the upsert covers a send whose
      // slot was taken by an earlier process. Increments only, in integers.
      await db
        .insert(t)
        .values({ orgId, day, count: 0, feeLamports: cost.feeLamports, rentLamports: cost.rentLamports })
        .onConflictDoUpdate({
          target: [t.orgId, t.day],
          set: { feeLamports: sql`${t.feeLamports} + ${cost.feeLamports}`, rentLamports: sql`${t.rentLamports} + ${cost.rentLamports}`, updatedAt: new Date() },
        });
    },
    async list(fromDay) {
      const rows = await db.select({ orgId: t.orgId, day: t.day, count: t.count, feeLamports: t.feeLamports, rentLamports: t.rentLamports }).from(t).where(gte(t.day, fromDay));
      return rows.map((r) => ({ orgId: r.orgId, day: r.day, count: r.count, feeLamports: BigInt(r.feeLamports), rentLamports: BigInt(r.rentLamports) }));
    },
  };
}
