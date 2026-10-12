import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import { linkVerifiedIdentity } from '../lib/auth/accounts.ts';
import { UnauthorizedError, resolveAuthorityFromDb } from '../lib/auth/authority.ts';
import { IDLE_TIMEOUT_MS, evaluateIdle } from '../lib/auth/idle-timeout.ts';

/*
 * Identity authorizes nothing.
 *
 * Signing in (password or Google) says who someone is. What they may do comes
 * from a membership row; what they can SIGN comes from the device key they
 * registered for that membership. This file pins the first half: no sign-in
 * path grants authority, and an unattended browser stops being signed in.
 */

async function migratedDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(new URL('../drizzle', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  return { client, db };
}

/** Source with comments stripped, so prose that names a function is not a call. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/* ── Sign-in grants nothing ────────────────────────────────────────────── */

test('a Google identity, fully linked, can authorize nothing', async () => {
  const { client, db } = await migratedDb();
  await linkVerifiedIdentity(db, { email: 'ceo@acme.com', name: 'CEO' });
  await assert.rejects(() => resolveAuthorityFromDb(db, 'ceo@acme.com'), UnauthorizedError);
  await client.close();
});

test('no sign-in file touches the memberships table', async () => {
  const files = [
    '../app/api/auth/google/start/route.ts',
    '../app/api/auth/google/callback/route.ts',
    '../lib/auth/google-oidc.ts',
    '../app/api/auth/login/route.ts',
    '../components/auth/LoginForm.tsx',
    '../components/auth/GoogleSignInButton.tsx',
  ];
  for (const rel of files) {
    const source = code(await readFile(new URL(rel, import.meta.url), 'utf8'));
    assert.doesNotMatch(source, /memberships|grantMembership|provisionOperatorMembership/, `${rel} must not grant authority`);
  }
  // linkVerifiedIdentity creates or claims an account; it never grants a role.
  const accounts = code(await readFile(new URL('../lib/auth/accounts.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(accounts, /memberships/);
});

test('no key material is derived from a sign-in', async () => {
  for (const rel of ['../lib/auth/google-oidc.ts', '../app/api/auth/google/callback/route.ts']) {
    const source = code(await readFile(new URL(rel, import.meta.url), 'utf8'));
    assert.doesNotMatch(source, /Keypair|deriveKey|fromSeed|salt/i, `${rel} must not derive a key from the identity`);
  }
});

/* ── idle timeout ──────────────────────────────────────────────────────── */

test('the idle window is fifteen minutes and closes on the far side of it', () => {
  assert.equal(IDLE_TIMEOUT_MS, 15 * 60 * 1000);
  const now = Date.now();
  assert.equal(evaluateIdle(now - 60_000, now).state, 'active');
  assert.equal(evaluateIdle(now - 14 * 60 * 1000, now).state, 'active');
  assert.equal(evaluateIdle(now - IDLE_TIMEOUT_MS, now).state, 'expired');
  assert.equal(evaluateIdle(now - 60 * 60 * 1000, now).state, 'expired');
});

test('a session with no lastSeen is stamped rather than logged out', () => {
  // A deploy must not sign everyone out.
  const v = evaluateIdle(undefined);
  assert.equal(v.state, 'active');
  assert.equal(v.refresh, true);
});

test('a lastSeen in the future is treated as now, not as negative idleness', () => {
  const now = Date.now();
  const v = evaluateIdle(now + 60_000, now);
  assert.equal(v.state, 'active');
  assert.equal(v.idleMs, 0);
});

test('the session read enforces the window, and a read alone does not extend it', async () => {
  const source = code(await readFile(new URL('../lib/server/customer-auth.ts', import.meta.url), 'utf8'));
  assert.match(source, /evaluateIdle/);
  assert.match(source, /expired[\s\S]{0,40}return null/);
});
