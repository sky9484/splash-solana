/**
 * The health checks, once. GET /api/health and `npm run doctor` both call
 * these — one implementation of "is X healthy", so the endpoint an operator
 * curls and the table a developer reads can never disagree about the same
 * machine.
 *
 * Every check returns a Check: ok, a one-line detail, and never a secret.
 * DATABASE_URL is reported as its host; keys are reported as present or not.
 * Each network probe is bounded by a timeout so a dead dependency shows as
 * `ok: false` in a few seconds rather than hanging the page.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { getEnv } from '@/lib/env';
import { checkLaunchScope, checkPasskeyDomain, checkScreening, checkTwilio } from '@/lib/server/go-live-checks';
import { getSealHealthSnapshot } from '@/lib/evidence-sui/seal-health';
import { getSealConfig } from '@/lib/evidence-sui/seal-config';
import { readSolanaEnv } from '@/lib/solana/config';

export type Check = {
  ok: boolean;
  /** 'skipped' when the thing is deliberately not configured in this
   *  environment. Invariant: ok === (status !== 'fail'), so a consumer
   *  reading either field reaches the same conclusion. */
  status: 'ok' | 'fail' | 'skipped';
  detail: string;
  latencyMs?: number;
  data?: Record<string, unknown>;
};

const TIMEOUT_MS = 6_000;

async function timed<T>(label: string, run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await Promise.race([
    run(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)),
  ]);
  return { value, ms: Date.now() - started };
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ── Solana RPC ───────────────────────────────────────────────────────── */

/** The Solana RPC the app sends through. Offline mode touches no network, so it is skipped. */
export async function checkRpc(): Promise<Check> {
  const sol = readSolanaEnv();
  if (sol.mode === 'offline') {
    return { ok: true, status: 'skipped', detail: 'SPLASH_SOLANA_MODE=offline: the chain simulator answers, no RPC is used', data: { mode: sol.mode } };
  }
  const host = (() => { try { return new URL(sol.rpcUrl).host; } catch { return sol.rpcUrl; } })();
  try {
    const { value, ms } = await timed('Solana RPC', async () => {
      const res = await fetch(sol.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      return (await res.json()) as { result?: string; error?: { message?: string } };
    });
    if (value.result !== 'ok') {
      return { ok: false, status: 'fail', detail: `${sol.cluster} via ${host}: ${value.error?.message ?? 'not healthy'}`, latencyMs: ms, data: { cluster: sol.cluster, host } };
    }
    return { ok: true, status: 'ok', detail: `${sol.cluster} via ${host}: healthy`, latencyMs: ms, data: { cluster: sol.cluster, host } };
  } catch (e) {
    return { ok: false, status: 'fail', detail: `${sol.cluster} via ${host}: ${reason(e)}`, data: { cluster: sol.cluster, host } };
  }
}

/* ── Kora fee payer ───────────────────────────────────────────────────── */

/** Kora pays network fees so nobody needs SOL on the direct route. Required on devnet. */
export async function checkKora(): Promise<Check> {
  const sol = readSolanaEnv();
  if (sol.mode === 'offline') {
    return { ok: true, status: 'skipped', detail: 'offline: the simulator plays the fee payer' };
  }
  if (!sol.koraRpcUrl) {
    return { ok: false, status: 'fail', detail: 'KORA_RPC_URL is not set: sponsored transactions are refused on devnet' };
  }
  const host = (() => { try { return new URL(sol.koraRpcUrl as string).host; } catch { return '(unparseable url)'; } })();
  try {
    const { createKoraClient } = await import('@/lib/solana/kora');
    const kora = createKoraClient({ rpcUrl: sol.koraRpcUrl, apiKey: process.env.KORA_API_KEY });
    const { value, ms } = await timed('Kora', () => kora.getPayerSigner());
    return { ok: true, status: 'ok', detail: `fee payer ${value.signer_address} via ${host}`, latencyMs: ms, data: { host } };
  } catch (e) {
    return { ok: false, status: 'fail', detail: `Kora via ${host}: ${reason(e)}`, data: { host } };
  }
}

/* ── Postgres ─────────────────────────────────────────────────────────── */

function migrationFilesOnDisk(): number {
  try {
    return readdirSync(path.join(process.cwd(), 'drizzle')).filter((f) => f.endsWith('.sql')).length;
  } catch {
    return 0;
  }
}

export async function checkDb(): Promise<Check> {
  const env = getEnv();
  if (!env.DATABASE_URL) {
    return { ok: true, status: 'skipped', detail: 'DATABASE_URL not set — authority and persistence fall back to local demo state' };
  }
  const host = (() => { try { return new URL(env.DATABASE_URL).host; } catch { return '(unparseable url)'; } })();
  try {
    const { getDb } = await import('@/lib/db/client');
    const { sql } = await import('drizzle-orm');
    const db = getDb();
    const { ms } = await timed('SELECT 1', () => db.execute(sql`select 1`));

    // drizzle-kit's default journal table. Applied rows vs .sql files on disk
    // is what "migrated" means; a fresh cluster has the table missing.
    const onDisk = migrationFilesOnDisk();
    let applied = -1;
    try {
      const rows = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
      const shape = rows as unknown as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const first = Array.isArray(shape) ? shape[0] : shape.rows?.[0];
      applied = Number(first?.n ?? -1);
    } catch {
      applied = 0;
    }
    const migrated = onDisk > 0 && applied >= onDisk;
    return {
      ok: migrated,
      status: migrated ? 'ok' : 'fail',
      detail: migrated
        ? `${host} reachable, ${applied}/${onDisk} migrations applied`
        : `${host} reachable, but ${applied}/${onDisk} migrations applied — run npm run db:migrate:run`,
      latencyMs: ms,
      data: { host, applied, onDisk },
    };
  } catch (e) {
    return { ok: false, status: 'fail', detail: `${host} — ${reason(e)}`, data: { host } };
  }
}

/* ── Seal ─────────────────────────────────────────────────────────────── */

export async function checkSeal(): Promise<Check> {
  let source = '';
  try {
    const config = getSealConfig();
    source = config.source;
    const snapshot = getSealHealthSnapshot();
    const data = {
      source,
      configured: config.configured,
      mode: config.mode,
      threshold: config.threshold,
      servers: config.serverConfigs.length,
      status: snapshot.status,
      reachableWeight: snapshot.reachableWeight,
      configuredWeight: snapshot.configuredWeight,
    };
    if (!config.configured) {
      const prod = getEnv().NODE_ENV === 'production';
      return { ok: !prod, status: prod ? 'fail' : 'skipped', detail: `${source} — unconfigured (no committee); ${prod ? 'production fails closed' : 'development uses demo records'}`, data };
    }
    const ok = snapshot.status === 'healthy';
    return {
      ok,
      status: ok ? 'ok' : 'fail',
      detail: `${source} — ${config.serverConfigs.length} servers, threshold ${config.threshold}, ${snapshot.status} (${snapshot.reachableWeight}/${snapshot.configuredWeight} weight reachable)${snapshot.reason ? ` — ${snapshot.reason}` : ''}`,
      data,
    };
  } catch (e) {
    return { ok: false, status: 'fail', detail: reason(e), data: { source } };
  }
}

/* ── Flags ────────────────────────────────────────────────────────────── */

export function featureFlags(): Record<string, string | boolean> {
  const env = getEnv();
  return {
    NODE_ENV: env.NODE_ENV,
    SPLASH_SOLANA_MODE: readSolanaEnv().mode,
    SOLANA_CLUSTER: readSolanaEnv().cluster,
    USE_MOCK_APIS: env.USE_MOCK_APIS,
    LAUNCH_SCOPE: env.LAUNCH_SCOPE,
    NEXT_PUBLIC_DEMO_MODE: env.NEXT_PUBLIC_DEMO_MODE,
    FEATURE_GOOGLE_SIGNIN: env.FEATURE_GOOGLE_SIGNIN,
    FEATURE_KYB_GATE: env.FEATURE_KYB_GATE,
    FEATURE_DUAL_FUNDING: env.FEATURE_DUAL_FUNDING,
    OXWAL_CHAIN_MODE: env.OXWAL_CHAIN_MODE,
    CARD_FUNDING_ENABLED: env.CARD_FUNDING_ENABLED,
    TREASURY_EXECUTION_ENABLED: env.TREASURY_EXECUTION_ENABLED,
  };
}

/* ── Everything ───────────────────────────────────────────────────────── */

export type HealthReport = {
  ok: boolean;
  checkedAt: string;
  flags: Record<string, string | boolean>;
  checks: {
    rpc: Check; kora: Check; db: Check; seal: Check;
    /* Go-live: the setup a person does by hand (lib/server/go-live-checks.ts). */
    twilio: Check; passkeyDomain: Check; screening: Check;
    launchScope: Check;
  };
};

export async function runHealthChecks(): Promise<HealthReport> {
  const [rpc, kora, db, seal, twilio, screening] = await Promise.all([
    checkRpc(), checkKora(), checkDb(), checkSeal(), checkTwilio(), checkScreening(),
  ]);
  const checks = {
    rpc, kora, db, seal,
    twilio, passkeyDomain: checkPasskeyDomain(), screening,
    launchScope: checkLaunchScope(),
  };
  // 'skipped' is not a failure: it is a deliberate absence in this env.
  const ok = Object.values(checks).every((c) => c.status !== 'fail');
  return { ok, checkedAt: new Date().toISOString(), flags: featureFlags(), checks };
}
