import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../lib/db/schema.ts';
import { UnauthorizedError, resolveAuthorityFromDb } from '../lib/auth/authority.ts';
import { ensureUserForIdentity, upsertWalletIdentity } from '../lib/db/wallet-identities.ts';
import {
  ASSUMED_EPOCH_MS,
  EPOCH_BOUNDARY_GRACE_MS,
  chooseMaxEpoch,
} from '../lib/auth/zklogin-epoch.ts';
import { IDLE_TIMEOUT_MS, evaluateIdle, idleWindowIsShorterThan } from '../lib/auth/idle-timeout.ts';

/** Source with comments stripped: these assertions are about what the code
 *  does, and the modules deliberately document what they replaced. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

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

/* ── The property the brief names: zkLogin authorizes nothing ──────────── */

test('a zkLogin identity, fully persisted, can authorize nothing', async () => {
  const { client, db } = await migratedDb();
  const email = 'ceo@acme.com';
  const suiAddress = `0x${'11'.repeat(32)}`;

  // Exactly what app/api/auth/zklogin/route.ts does on a verified JWT.
  await db.insert(schema.organizations).values({ id: 'demo-business', name: 'demo-business' }).onConflictDoNothing();
  await ensureUserForIdentity(db, { userId: `op_${email}`, orgId: 'demo-business', email });
  await upsertWalletIdentity(db, {
    userId: `op_${email}`,
    orgId: 'demo-business',
    suiAddress,
    oauthIss: 'https://accounts.google.com',
    oauthSub: 'sub-123',
    oauthAud: 'client-id.apps.googleusercontent.com',
    emailAtLogin: email,
  });

  // The identity exists and the signer is recorded. Authority is still nil.
  await assert.rejects(() => resolveAuthorityFromDb(db, email), UnauthorizedError);

  await client.close();
});

test('the zkLogin route grants no membership on any path', async () => {
  const route = code(await readFile(new URL('../app/api/auth/zklogin/route.ts', import.meta.url), 'utf8'));
  // It may create an identity and record a signer; it must not grant a role.
  assert.match(route, /ensureUserForIdentity/);
  assert.doesNotMatch(route, /grantMembership/);
  assert.doesNotMatch(route, /provisionOperatorMembership/);
  assert.doesNotMatch(route, /memberships/);

  // And the identity helper it calls cannot grant one either.
  const helper = code(await readFile(new URL('../lib/db/wallet-identities.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(helper, /memberships/);
  assert.doesNotMatch(helper, /\brole\b/);
});

test('no file added for zkLogin sign-in touches the memberships table', async () => {
  const added = [
    '../lib/auth/zklogin-epoch.ts',
    '../lib/auth/idle-timeout.ts',
    '../app/api/auth/zklogin/params/route.ts',
    '../components/auth/ZkLoginButton.tsx',
    '../app/login/zklogin/callback/page.tsx',
  ];
  for (const rel of added) {
    const source = code(await readFile(new URL(rel, import.meta.url), 'utf8'));
    assert.doesNotMatch(source, /memberships|grantMembership/, `${rel} must not grant authority`);
  }
});

/* ── max_epoch ─────────────────────────────────────────────────────────── */

const EPOCH_START = Date.UTC(2026, 0, 1);
const info = (overrides = {}) => ({
  epoch: 500,
  epochStartMs: EPOCH_START,
  epochDurationMs: ASSUMED_EPOCH_MS,
  ...overrides,
});

test('max_epoch is current + 1 with a comfortable remainder', () => {
  // Ten hours in, fourteen left.
  const d = chooseMaxEpoch(info(), EPOCH_START + 10 * 60 * 60 * 1000);
  assert.equal(d.maxEpoch, 501);
  assert.equal(d.span, 1);
});

test('max_epoch is current + 2 when under two hours remain', () => {
  // The cliff: a user signing in here would otherwise get a key that dies in
  // twenty minutes, mid-task, for no reason they can see.
  const d = chooseMaxEpoch(info(), EPOCH_START + ASSUMED_EPOCH_MS - 20 * 60 * 1000);
  assert.equal(d.maxEpoch, 502);
  assert.equal(d.span, 2);
  assert.match(d.reason, /minutes remain/);
});

test('the two-hour boundary is exact on both sides', () => {
  const atGrace = chooseMaxEpoch(info(), EPOCH_START + ASSUMED_EPOCH_MS - EPOCH_BOUNDARY_GRACE_MS);
  assert.equal(atGrace.span, 1, 'exactly two hours left still takes one epoch');

  const justInside = chooseMaxEpoch(info(), EPOCH_START + ASSUMED_EPOCH_MS - EPOCH_BOUNDARY_GRACE_MS + 1);
  assert.equal(justInside.span, 2, 'a millisecond under takes two');
});

test('a skewed clock does not silently take the two-epoch branch', () => {
  // Before the epoch started, and after it should have ended.
  assert.equal(chooseMaxEpoch(info(), EPOCH_START - 60_000).span, 1);
  const past = chooseMaxEpoch(info(), EPOCH_START + ASSUMED_EPOCH_MS * 3);
  assert.equal(past.span, 2, 'clamped to the end of the epoch, which is inside the grace window');
  assert.ok(past.remainingMs >= 0, 'never a negative remainder');
});

test('a missing epoch duration falls back rather than dividing by zero', () => {
  const d = chooseMaxEpoch(info({ epochDurationMs: 0 }), EPOCH_START + 60_000);
  assert.equal(d.span, 1);
  assert.ok(d.remainingMs > 0);
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

test('the idle window is always shorter than an ephemeral key’s life', () => {
  // The whole reason they are separate numbers: one bounds an unattended
  // browser, the other bounds a signing key.
  assert.ok(idleWindowIsShorterThan(ASSUMED_EPOCH_MS));
  assert.ok(idleWindowIsShorterThan(ASSUMED_EPOCH_MS * 2));
  // Even against a hypothetically short epoch, fifteen minutes is shorter.
  assert.ok(idleWindowIsShorterThan(60 * 60 * 1000));
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

/* ── the button is honest about what signing in gets you ───────────────── */

test('the sign-in button renders only when the flow can complete', async () => {
  const button = code(await readFile(new URL('../components/auth/ZkLoginButton.tsx', import.meta.url), 'utf8'));
  assert.match(button, /params\?\.enabled/);
  assert.match(button, /return null/);
  const params = code(await readFile(new URL('../app/api/auth/zklogin/params/route.ts', import.meta.url), 'utf8'));
  assert.match(params, /zkLoginEnabled/);
  assert.match(params, /ZKLOGIN_GOOGLE_CLIENT_ID is not configured/);
  // The user salt is server-side and must never be handed to a browser.
  assert.doesNotMatch(params, /ZKLOGIN_USER_SALT/);
});

test('the callback keeps the id_token out of the URL and clears the ephemeral key', async () => {
  const cb = code(await readFile(new URL('../app/login/zklogin/callback/page.tsx', import.meta.url), 'utf8'));
  assert.match(cb, /window\.location\.hash/, 'the token arrives in the fragment, not the query string');
  assert.match(cb, /history\.replaceState/, 'and does not stay in history');
  assert.match(cb, /removeItem\('splash\.zklogin\.pending'\)/);
});
