import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.ts';

/**
 * W1 — Postgres client for DigitalOcean Managed PostgreSQL.
 *
 * - `DATABASE_URL` comes from the DO cluster (never committed). DO managed
 *   clusters require TLS; their connection strings carry `sslmode=require`,
 *   and we trust the platform CA bundle (`--use-system-ca` runtime flag is
 *   already the repo convention for TLS-intercepted environments).
 * - globalThis-anchored like every store in this repo: route handlers and
 *   server components get separate module instances in dev, and the pool
 *   must not multiply per bundle.
 * - Redis remains cache/rate-limit only — this is the source of truth.
 */

export type Database = NodePgDatabase<typeof schema>;

type DbGlobal = typeof globalThis & { splashDb?: { pool: Pool; db: Database } };
const globalStore = globalThis as DbGlobal;

export function getDb(): Database {
  if (globalStore.splashDb) return globalStore.splashDb.db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — provision the DigitalOcean Managed PostgreSQL cluster and add its connection string to .env.local.');
  }

  const pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    // DO managed PG requires TLS. `sslmode=require` in the URL handles it;
    // this keeps non-URL configs honest too.
    ssl: connectionString.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
  });

  const db = drizzle(pool, { schema });
  globalStore.splashDb = { pool, db };
  return db;
}

export { schema };
