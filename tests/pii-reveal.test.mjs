// Prompt 10 Phase S §S.2: who can see a full number, and how. Owner or finance admin (`admin`), after
// a device approval (a server challenge signed by this member's device key, single use), for 30
// seconds; maker, checker and viewer are refused; every attempt is logged. Changed details block
// payment until a call-back passes. The shred job and its cron route.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { resetKms } from '../lib/server/kms/index.ts';
import {
  bankNumberForPayout,
  markBankDetailsVerified,
  mayRevealBankNumbers,
  revealBankNumber,
  revealChallenge,
  saveBankNumber,
  scheduleShredForRemoved,
  shredDue,
} from '../lib/server/bank-details.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore } from '../lib/solana-app/store.ts';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
  resetKms();
});

async function company() {
  const org = svc.createOrg({ companyName: 'Selangor Trading Sdn Bhd', personName: 'Aisyah' });
  const keys = createMemoryDeviceKeyStore();
  const device = await createDeviceKey(keys, org.id);
  const otherKeys = createMemoryDeviceKeyStore();
  await createDeviceKey(otherKeys, org.id);
  org.suppliers.push({ id: 'sup_manila', name: 'Manila Freight', bank: 'BPI', accountLast4: '4471', verified: { by: 'Aisyah', method: 'call-back', at: '2026-10-01T00:00:00.000Z' } });
  await saveBankNumber(org.id, 'sup_manila', { bankCode: 'BPI', accountNumber: '1234 5678 4471' });
  const sign = async (message) => bs58.encode(await signWithDeviceKey(keys, org.id, new TextEncoder().encode(message)));
  /** Another device’s key: a valid signature, from the wrong device. */
  const signElsewhere = async (message) => bs58.encode(await signWithDeviceKey(otherKeys, org.id, new TextEncoder().encode(message)));
  const actor = (role, extra = {}) => ({ orgId: org.id, userId: `user_${role}`, isOwner: role === 'owner', role: role === 'owner' ? 'admin' : role, deviceKey: device.publicKey, ...extra });
  return { org, device, sign, signElsewhere, actor };
}

test('owner and finance admin may see a number; maker, checker and viewer may not (no new role)', () => {
  assert.equal(mayRevealBankNumbers({ isOwner: true, role: 'maker' }), true);
  assert.equal(mayRevealBankNumbers({ isOwner: false, role: 'admin' }), true);
  for (const role of ['maker', 'checker', 'viewer', undefined]) assert.equal(mayRevealBankNumbers({ isOwner: false, role }), false, String(role));
});

test('with a fresh device approval the owner sees the number, for 30 seconds, and it is logged', async () => {
  const { org, sign, actor } = await company();
  const now = new Date('2026-10-14T03:00:00.000Z');
  const owner = actor('owner');
  const c = await revealChallenge(owner, 'sup_manila', now);
  assert.match(c.message, /^splash:challenge:v1:reveal\norg:/, 'domain-separated: never a transaction');
  assert.match(c.message, /recipient:sup_manila/);
  const shown = await revealBankNumber(owner, 'sup_manila', { nonce: c.nonce, signature: await sign(c.message) }, new Date(now.getTime() + 5_000));
  assert.equal(shown.accountNumber, '123456784471');
  assert.equal(shown.last4, '4471');
  assert.equal(Date.parse(shown.expiresAt) - (now.getTime() + 5_000), 30_000, 'expires 30 seconds ahead');
  const log = await runtime().secrets.reveals(org.id);
  assert.deepEqual(log.map((e) => e.result), ['challenged', 'revealed']);
  assert.ok(log.every((e) => e.userId === 'user_owner' && e.beneficiaryId === 'sup_manila'));
});

test('the finance admin too; every other role is refused and logged, at either step', async () => {
  const { org, sign, actor } = await company();
  const admin = actor('admin');
  const c = await revealChallenge(admin, 'sup_manila');
  assert.equal((await revealBankNumber(admin, 'sup_manila', { nonce: c.nonce, signature: await sign(c.message) })).last4, '4471');
  for (const role of ['maker', 'checker', 'viewer']) {
    await assert.rejects(revealChallenge(actor(role), 'sup_manila'), (e) => e.status === 403 && e.code === 'not_authorized', role);
    // Even holding a valid approval made for someone else, the role decides.
    const ownerC = await revealChallenge(actor('owner'), 'sup_manila');
    await assert.rejects(revealBankNumber(actor(role), 'sup_manila', { nonce: ownerC.nonce, signature: await sign(ownerC.message) }), (e) => e.status === 403, role);
  }
  const refused = (await runtime().secrets.reveals(org.id)).filter((e) => e.result === 'refused');
  assert.deepEqual(refused.map((e) => e.reason), ['role maker', 'role maker', 'role checker', 'role checker', 'role viewer', 'role viewer']);
});

test('no step-up, an old one, a reused one, someone else’s, or a signature from another key: refused and logged', async () => {
  const { org, sign, signElsewhere, actor } = await company();
  const owner = actor('owner');
  const now = new Date('2026-10-14T03:00:00.000Z');
  await assert.rejects(revealBankNumber(owner, 'sup_manila', { nonce: 'a'.repeat(64), signature: '1'.repeat(88) }, now), (e) => e.status === 401);

  const late = await revealChallenge(owner, 'sup_manila', now);
  await assert.rejects(revealBankNumber(owner, 'sup_manila', { nonce: late.nonce, signature: await sign(late.message) }, new Date(now.getTime() + 61_000)), /expired/);

  const once = await revealChallenge(owner, 'sup_manila', now);
  const sig = await sign(once.message);
  await revealBankNumber(owner, 'sup_manila', { nonce: once.nonce, signature: sig }, now);
  await assert.rejects(revealBankNumber(owner, 'sup_manila', { nonce: once.nonce, signature: sig }, now), (e) => e.status === 401, 'single use');

  const mine = await revealChallenge(owner, 'sup_manila', now);
  await assert.rejects(revealBankNumber(actor('admin'), 'sup_manila', { nonce: mine.nonce, signature: await sign(mine.message) }, now), (e) => e.status === 401, 'bound to the member who asked');

  const forged = await revealChallenge(owner, 'sup_manila', now);
  const forgedSig = await signElsewhere(forged.message);
  await assert.rejects(revealBankNumber(owner, 'sup_manila', { nonce: forged.nonce, signature: forgedSig }, now), (e) => e.status === 401);

  // A recipient that isn't there: refused, and still logged.
  await assert.rejects(revealChallenge(owner, 'sup_nobody', now), (e) => e.status === 404 && e.code === 'recipient_not_found');

  const log = await runtime().secrets.reveals(org.id);
  assert.equal(log.filter((e) => e.result === 'revealed').length, 1);
  assert.ok(log.filter((e) => e.result === 'refused').length >= 6);
  assert.ok(log.some((e) => e.result === 'refused' && e.reason === 'no such recipient' && e.beneficiaryId === 'sup_nobody'));
  assert.ok(log.every((e) => !JSON.stringify(e).includes('123456784471')), 'the log never holds the number');
});

test('changed bank details: a new record, the old one replaced, and no payment until a call-back passes', async () => {
  const { org } = await company();
  const same = await saveBankNumber(org.id, 'sup_manila', { bankCode: 'BPI', accountNumber: '123456784471' });
  assert.equal(same.changed, false, 'the same number again changes nothing');
  assert.deepEqual(await bankNumberForPayout(org.id, 'sup_manila'), { accountNumber: '123456784471', last4: '4471' });

  const changed = await saveBankNumber(org.id, 'sup_manila', { bankCode: 'BPI', accountNumber: '9999 0000 2290' });
  assert.equal(changed.changed, true);
  const history = await runtime().secrets.history(org.id, 'sup_manila');
  assert.deepEqual(history.map((r) => [r.last4, r.replacedAt === null]), [['2290', true], ['4471', false]]);
  const supplier = svc.getOrg(org.id).suppliers[0];
  assert.equal(supplier.accountLast4, '2290');
  assert.equal(supplier.secretId, changed.secretId);
  await assert.rejects(bankNumberForPayout(org.id, 'sup_manila'), (e) => e.code === 'bank_details_unverified');

  markBankDetailsVerified(org.id, 'sup_manila', 'Aisyah', 'call-back');
  assert.equal((await bankNumberForPayout(org.id, 'sup_manila')).last4, '2290');
});

test('removing a recipient schedules the shred 30 days on; the job destroys due records only, twice is once', async () => {
  const { org } = await company();
  org.suppliers.push({ id: 'sup_cebu', name: 'Cebu Packaging', bank: 'BDO', accountLast4: '7777', verified: { by: 'Aisyah', method: 'call-back', at: '2026-10-01T00:00:00.000Z' } });
  await saveBankNumber(org.id, 'sup_cebu', { bankCode: 'BDO', accountNumber: '555566667777' });
  const removedAt = new Date('2026-10-14T00:00:00.000Z');
  const { shredAfter, records } = await scheduleShredForRemoved(org.id, { id: 'sup_manila', name: 'Manila Freight', bank: 'BPI' }, removedAt);
  assert.equal(records, 1);
  assert.equal(shredAfter.toISOString(), '2026-11-13T00:00:00.000Z', 'never paid: 30 days from removal');
  assert.deepEqual(await shredDue(new Date('2026-11-12T23:59:59.000Z')), { shredded: 0 });
  assert.deepEqual(await shredDue(new Date('2026-11-13T00:00:00.000Z')), { shredded: 1 });
  assert.deepEqual(await shredDue(new Date('2026-11-14T00:00:00.000Z')), { shredded: 0 }, 'idempotent');
  const [gone] = await runtime().secrets.history(org.id, 'sup_manila');
  assert.equal(gone.last4, '4471', 'history keeps last4');
  assert.equal(gone.ciphertext, null);
  assert.ok((await runtime().secrets.current(org.id, 'sup_cebu')).ciphertext, 'another recipient untouched');
});

test('the shred job’s route answers the scheduler only (bearer CRON_SECRET), and runs the job', async () => {
  const { cronAuthorized } = await import('../lib/server/cron-auth.ts');
  const req = (auth) => new Request('http://localhost/api/cron/pii-shred', auth ? { headers: { authorization: auth } } : {});
  const secret = 's'.repeat(40);
  assert.equal(cronAuthorized(req(`Bearer ${secret}`), undefined), false, 'no secret configured: nobody');
  assert.equal(cronAuthorized(req(null), secret), false);
  assert.equal(cronAuthorized(req(`Bearer ${'s'.repeat(39)}`), secret), false);
  assert.equal(cronAuthorized(req(secret), secret), false, 'the Bearer prefix is required');
  assert.equal(cronAuthorized(req(`Bearer ${secret}`), secret), true);

  const { org } = await company();
  await scheduleShredForRemoved(org.id, { id: 'sup_manila', name: 'Manila Freight', bank: 'BPI' }, new Date('2026-01-01T00:00:00.000Z'));
  const { GET } = await import('../app/api/cron/pii-shred/route.ts');
  const before = process.env.CRON_SECRET;
  process.env.CRON_SECRET = secret;
  try {
    assert.equal((await GET(req('Bearer wrong'))).status, 401);
    assert.equal((await runtime().secrets.current(org.id, 'sup_manila')).shreddedAt, null, 'a refused call does nothing');
    const res = await GET(req(`Bearer ${secret}`));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, shredded: 1 });
    assert.deepEqual(await (await GET(req(`Bearer ${secret}`))).json(), { success: true, shredded: 0 }, 'twice is once');
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
});
