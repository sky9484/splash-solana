import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { featureFlags } from '../lib/server/health-checks.ts';

/* The service probes need a network and a database, so they are exercised by
   `npm run doctor` against a real machine rather than asserted here. What is
   worth pinning is the contract every consumer depends on: the shape, the
   ok/status invariant, that no secret can reach the body, and that the route
   is gated in production. */

const routeSource = readFileSync(new URL('../app/api/health/route.ts', import.meta.url), 'utf8');
const checksSource = readFileSync(new URL('../lib/server/health-checks.ts', import.meta.url), 'utf8');
const doctorSource = readFileSync(new URL('../scripts/doctor.mjs', import.meta.url), 'utf8');

test('flags report the posture switches an operator needs, and only those', () => {
  const flags = featureFlags();
  for (const key of ['NODE_ENV', 'SUI_NETWORK', 'SUI_SETTLEMENT_MODE', 'USE_MOCK_APIS', 'FEATURE_ZKLOGIN', 'OXWAL_CHAIN_MODE']) {
    assert.ok(key in flags, `${key} should be reported`);
  }
  // Nothing whose name suggests a secret is a flag.
  for (const key of Object.keys(flags)) {
    assert.doesNotMatch(key, /KEY|SECRET|PASSWORD|PRIVATE|TOKEN|URL$/, `${key} must not be reported as a flag`);
  }
});

test('every check reports ok consistently with status', () => {
  // The invariant the type documents: ok === (status !== 'fail'). Asserted on
  // the source because the probes need a network to run.
  const returns = [...checksSource.matchAll(/\{\s*ok:\s*(true|false|!prod|ok|migrated)[^}]*?status:\s*(?:(prod \? 'fail' : 'skipped')|(?:(ok|migrated) \? 'ok' : 'fail')|'(ok|fail|skipped)')/g)];
  assert.ok(returns.length >= 6, `expected several check returns, found ${returns.length}`);
  for (const m of returns) {
    const okExpr = m[1];
    const literal = m[4];
    if (literal === 'skipped') {
      assert.equal(okExpr, 'true', `a skipped check must report ok: true — found ok: ${okExpr}`);
    }
    if (literal === 'fail') {
      assert.equal(okExpr, 'false', `a failed check must report ok: false — found ok: ${okExpr}`);
    }
  }
});

test('the aggregate treats skipped as passing and fail as failing', () => {
  assert.match(checksSource, /const ok = Object\.values\(checks\)\.every\(\(c\) => c\.status !== 'fail'\)/);
});

test('secrets never reach the body: the url is reduced to a host, the key to presence', () => {
  // DATABASE_URL is only ever read to construct a URL and take .host.
  const dbUses = [...checksSource.matchAll(/env\.DATABASE_URL/g)];
  assert.ok(dbUses.length > 0);
  assert.match(checksSource, /new URL\(env\.DATABASE_URL\)\.host/);
  assert.doesNotMatch(checksSource, /detail:[^\n]*env\.DATABASE_URL[^\n]*\}/);
  // The Enoki key is sent as a header, never placed in a detail or data field.
  assert.match(checksSource, /Authorization: `Bearer \$\{key\}`/);
  assert.doesNotMatch(checksSource, /detail:[^\n]*\$\{key\}/);
  assert.doesNotMatch(checksSource, /data:[^\n]*\bkey\b/);
});

test('the route is public in development and staff-gated in production', () => {
  assert.match(routeSource, /getEnv\(\)\.NODE_ENV === 'production'/);
  assert.match(routeSource, /getAdminSession\(\)/);
  assert.match(routeSource, /status: 401/);
  assert.match(routeSource, /export const dynamic = 'force-dynamic'/);
  assert.match(routeSource, /'Cache-Control': 'no-store'/);
  // 503 when unhealthy, so a probe or uptime monitor sees it without parsing.
  assert.match(routeSource, /status: report\.ok \? 200 : 503/);
});

test('doctor and the route call the same module, so they cannot disagree', () => {
  assert.match(routeSource, /from '@\/lib\/server\/health-checks'/);
  assert.match(doctorSource, /runHealthChecks/);
  assert.match(doctorSource, /@\/lib\/server\/health-checks\.ts/);
  // and doctor exits non-zero on failure, so CI or a hook can gate on it
  assert.match(doctorSource, /finish\(1\)/);
  assert.match(doctorSource, /process\.exitCode = code/);
});

test('doctor loads .env.local, which plain Node does not do on its own', () => {
  assert.match(doctorSource, /process\.loadEnvFile/);
  assert.match(doctorSource, /'\.env\.local'/);
});
