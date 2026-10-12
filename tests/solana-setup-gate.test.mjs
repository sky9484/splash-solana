import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { openSetupClaim, sealSetupClaim } from '../lib/server/setup-cookie.ts';
import { isSetupExempt, setupRedirectFor } from '../lib/server/setup-gate.ts';

/*
 * The device check after sign-in (prompt 07 §3.2): a signed-in person without
 * a registered device, or whose device is not in the vault, reaches only setup
 * and their own account pages. It fails closed.
 */

const device = { id: 'd', userId: 'u', orgId: 'acme', publicKey: 'K', label: 'This device', provenAt: new Date() };
const vault = { orgId: 'acme', members: [{ role: 'admin_device', publicKey: 'K' }] };

test('without a device, the money pages send you to setup', () => {
  for (const path of ['/dashboard', '/dashboard/transfer', '/dashboard/batch', '/dashboard/history', '/dashboard/treasury']) {
    assert.equal(setupRedirectFor(path, { state: 'no_device', orgId: 'acme', userId: 'u', vault: null }), '/dashboard/setup', path);
  }
});

test('every state short of ready sends you to setup, and an unreadable status does too (fail closed)', () => {
  for (const status of [
    null,
    { state: 'no_membership' },
    { state: 'no_device', orgId: 'acme', userId: 'u', vault: null },
    { state: 'no_vault', orgId: 'acme', userId: 'u', device },
    { state: 'device_not_in_vault', orgId: 'acme', userId: 'u', device, vault },
  ]) {
    assert.equal(setupRedirectFor('/dashboard/transfer', status), '/dashboard/setup', JSON.stringify(status?.state ?? null));
  }
  assert.equal(setupRedirectFor('/dashboard/transfer', { state: 'ready', orgId: 'acme', userId: 'u', device, vault }), null);
});

test('setup and your own account pages stay reachable before setup', () => {
  for (const path of ['/dashboard/setup', '/dashboard/setup/', '/dashboard/profile', '/dashboard/settings', '/dashboard/settings/security', '/dashboard/customer-service']) {
    assert.equal(isSetupExempt(path), true, path);
    assert.equal(setupRedirectFor(path, null), null, path);
  }
});

test('the exemption is by path segment, not by string prefix', () => {
  for (const path of ['/dashboard/setupx', '/dashboard/settings-export', '/dashboard/profile2/transfer']) {
    assert.equal(isSetupExempt(path), false, path);
  }
});

test('setup cookie: opens only for the session it was minted for', () => {
  const secret = 's'.repeat(64);
  const session = { email: 'Ops@Acme.com', credentialVersion: 3 };
  const sealed = sealSetupClaim({ email: session.email, credentialVersion: 3, devicePublicKey: 'K' }, secret);

  assert.deepEqual(openSetupClaim(sealed, secret, session), { email: 'ops@acme.com', credentialVersion: 3, devicePublicKey: 'K' });
  assert.equal(openSetupClaim(sealed, secret, { email: 'cfo@acme.com', credentialVersion: 3 }), null, 'another person');
  assert.equal(openSetupClaim(sealed, secret, { email: 'ops@acme.com', credentialVersion: 4 }), null, 'after a reset or mailbox proof');
  assert.equal(openSetupClaim(sealed, 't'.repeat(64), session), null, 'another secret');
  const [body, mac] = sealed.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'ops@acme.com', v: 3, k: 'OTHER' })).toString('base64url');
  assert.equal(openSetupClaim(`${forged}.${mac}`, secret, session), null, 'tampered');
  assert.equal(openSetupClaim(`${body}.`, secret, session), null, 'no mac');
  assert.equal(openSetupClaim(undefined, secret, session), null, 'absent');
});

test('the proxy reads cookies only, never the database', async () => {
  const gate = await readFile(new URL('../lib/server/setup-gate.ts', import.meta.url), 'utf8');
  const proxyFn = gate.slice(gate.indexOf('export async function proxySetupRedirect'), gate.indexOf('export async function refreshSetupCookie'));
  assert.ok(proxyFn.length > 0);
  assert.doesNotMatch(proxyFn, /readSetupStatus|getDb|db\/client/);
  assert.match(proxyFn, /openSetupClaim/);
});

test('the check runs in proxy.ts (every navigation) and in the dashboard layout (full loads)', async () => {
  const proxy = await readFile(new URL('../proxy.ts', import.meta.url), 'utf8');
  assert.match(proxy, /proxySetupRedirect\(pathname/);
  // The pathname header is always overwritten, never trusted from the client.
  assert.match(proxy, /requestHeaders\.set\('x-splash-pathname', pathname\)/);
  const layout = await readFile(new URL('../app/dashboard/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /setupRedirectFor\(/);
  assert.match(layout, /redirect\(setupRedirect\)/);
});
