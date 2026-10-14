// Prompt 10 Phase S §S.1.6 and §S.2: no full bank number in captured logs, error responses, company
// documents, payments, the invoice reader's record, Zeke's context, evidence bundles or analytics.
// The log scrubber's rules, and the one table allowed to hold a number (sealed).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { resetKms } from '../lib/server/kms/index.ts';
import { bankNumberForPayout, revealBankNumber, revealChallenge, saveBankNumber } from '../lib/server/bank-details.ts';
import { installLogScrubber, scrubText, scrubValue } from '../lib/server/log-scrub.ts';
import { handle } from '../lib/solana-app/http.ts';
import { encodeRecord } from '../lib/solana-app/payment-repo.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore, store } from '../lib/solana-app/store.ts';
import { ZEKE_PAGE_LABELS, zekeContextFor } from '../lib/solana-zeke/context.ts';

const FULL = '123456784471';
const SAMPLE_FULL = '002188304471'; // lib/solana-zeke/fixtures/sample-invoice.ts
const leaks = (text) => [FULL, SAMPLE_FULL, '1234 5678 4471', '1234-5678-4471', '0021-8830-4471'].filter((n) => text.includes(n));

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
  resetKms();
});

test('the scrubber: account-shaped digit runs keep their last 4; dates, ids, amounts and short numbers are left alone', () => {
  assert.equal(scrubText(`paying ${FULL} now`), 'paying ••••4471 now');
  assert.equal(scrubText('acct 1234 5678 4471.'), 'acct ••••4471.');
  assert.equal(scrubText('acct 1234-5678-4471'), 'acct ••••4471');
  assert.equal(scrubText('a 20-digit 12345678901234567890 run'), 'a 20-digit ••••7890 run');
  for (const keep of ['2026-10-14T03:00:00.000Z', 'INV-0415', '₱287,000.00', 'ends 4471', 'pay_9f3a2b1c0d4e5f60', 'sig 5h3XvT9k2PqZ8mN4', 'a 21-digit 123456789012345678901 run', '1234567']) {
    assert.equal(scrubText(keep), keep, keep);
  }
});

test('the scrubber: bank fields keep 4 digits at any length; errors keep their name; nothing else is touched', () => {
  const out = scrubValue({ accountNumber: '12345', supplier_account_number: 98765432, bankAccount: { iban: 'PH12BOPI00123456784471' }, accountLast4: '4471', usdcTokenAccount: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', amountMinor: '5000' });
  assert.deepEqual(out, { accountNumber: '••••2345', supplier_account_number: '••••5432', bankAccount: { iban: '••••4471' }, accountLast4: '4471', usdcTokenAccount: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', amountMinor: '5000' });
  const e = scrubValue(Object.assign(new TypeError(`bad ${FULL}`), { code: 'E_BAD' }));
  assert.equal(e.name, 'TypeError');
  assert.equal(e.code, 'E_BAD');
  assert.deepEqual(leaks(`${e.message} ${e.stack}`), []);
  const loop = { a: 1 };
  loop.self = loop;
  assert.doesNotThrow(() => scrubValue(loop));
});

test('installed on a console, every method writes scrubbed arguments; installing twice wraps once', () => {
  const lines = [];
  const fake = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug', 'trace'].map((m) => [m, (...a) => lines.push(a)]));
  installLogScrubber(fake);
  installLogScrubber(fake);
  fake.error('[api/solana]', new Error(`refused ${FULL}`));
  fake.log({ accountNumber: FULL });
  fake.warn(`x ${FULL}`);
  assert.equal(lines.length, 3);
  assert.deepEqual(leaks(JSON.stringify(lines.map((a) => a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : x))))), []);
});

test('end to end: save, reveal, a refusal, the payout read and a server error leave no number in logs, responses or stored records', async () => {
  // Capture what the server would write, through the same scrubber instrumentation.ts installs.
  const captured = [];
  const original = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
    original[m] = console[m];
    console[m] = (...a) => captured.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  }
  const capturing = { ...console };
  installLogScrubber(capturing);
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) console[m] = capturing[m];
  const responses = [];
  try {
    const org = svc.createOrg({ companyName: 'Selangor Trading Sdn Bhd', personName: 'Aisyah' });
    const keys = createMemoryDeviceKeyStore();
    const device = await createDeviceKey(keys, org.id);
    org.suppliers.push({ id: 'sup_manila', name: 'Manila Freight', bank: 'BPI', accountLast4: '4471', verified: { by: 'Aisyah', method: 'call-back', at: '2026-10-01T00:00:00.000Z' } });
    await saveBankNumber(org.id, 'sup_manila', { bankCode: 'BPI', accountNumber: FULL });
    const owner = { orgId: org.id, userId: 'u_owner', isOwner: true, role: 'admin', deviceKey: device.publicKey };
    const c = await revealChallenge(owner, 'sup_manila');
    const shown = await revealBankNumber(owner, 'sup_manila', { nonce: c.nonce, signature: bs58.encode(await signWithDeviceKey(keys, org.id, new TextEncoder().encode(c.message))) });
    assert.equal(shown.accountNumber, FULL, 'the person who may see it, sees it');
    await revealChallenge({ ...owner, userId: 'u_viewer', isOwner: false, role: 'viewer' }, 'sup_manila').catch(() => null);
    assert.equal((await bankNumberForPayout(org.id, 'sup_manila')).accountNumber, FULL);
    // An unexpected error that carries a number: logged scrubbed, answered scrubbed.
    const res = await handle(() => {
      throw new Error(`partner refused account ${FULL}`);
    });
    responses.push(await res.text());
    const { invoice } = await svc.readInvoiceDraft(org.id, { sample: true });

    // What was written: logs, the error response, the company, its invoices and evidence, the payments,
    // the reveal log. The only place the number lives is the sealed record.
    const documents = JSON.stringify(encodeRecord({ orgs: [...store().orgs.values()], invoices: [...store().invoices.values()], evidence: [...store().evidence.values()] }));
    const payments = JSON.stringify(encodeRecord(await runtime().payments.listByOrg(org.id)));
    const reveals = JSON.stringify(await runtime().secrets.reveals(org.id));
    const sealed = await runtime().secrets.current(org.id, 'sup_manila');
    assert.deepEqual(leaks(captured.join('\n')), [], 'logs');
    assert.deepEqual(leaks(responses.join('\n')), [], 'error response');
    assert.deepEqual(leaks(documents), [], 'company documents');
    assert.deepEqual(leaks(payments), [], 'payments');
    assert.deepEqual(leaks(reveals), [], 'reveal log');
    assert.deepEqual(leaks(JSON.stringify(encodeRecord(invoice))), [], 'the invoice reader keeps last4 only');
    assert.equal(invoice.draft.fields.supplierAccountLast4, '4471');
    assert.deepEqual(leaks(Buffer.from(sealed.ciphertext).toString('latin1') + Buffer.from(sealed.ciphertext).toString('base64')), [], 'sealed');
  } finally {
    for (const m of Object.keys(original)) console[m] = original[m];
  }
});

test('Zeke’s context is a page name, never an account number; evidence bundles and analytics carry last4 only', async () => {
  for (const label of ZEKE_PAGE_LABELS) assert.deepEqual(leaks(label), []);
  for (const path of ['/dashboard', '/dashboard/transfer', '/dashboard/recipients', '/dashboard/invoices']) assert.doesNotMatch(JSON.stringify(zekeContextFor(path, new URLSearchParams(`account=${FULL}`))), /\d{8,}/);
  const bundle = await readFile(new URL('../lib/solana-evidence/bundle.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(bundle, /accountNumber|account_number|bankAccountNumber/, 'the evidence bundle has no field for a full number');
  assert.match(bundle, /supplierAccountLast4/);
  const analytics = await readFile(new URL('../lib/observability/proposals.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(analytics, /accountNumber|account_number|bankAccountNumber/, 'analytics events carry no full number');
});

test('one table holds full numbers, sealed; the legacy plaintext column is the one known exception (open item)', async () => {
  const schema = await readFile(new URL('../lib/db/schema.ts', import.meta.url), 'utf8');
  const columns = [...schema.matchAll(/text\('([a-z_]*(?:account_number|account_ref|acct_no|iban|ciphertext)[a-z_]*)'\)/g)].map((m) => m[1]).sort();
  // bank_account_secrets.ciphertext is the sealed number. suppliers.bank_account_number and
  // account_ref belong to the legacy fiat recipients (lib/server/repository/recipients.ts): plaintext,
  // written by the legacy Recipients page and Zeke's proposeRecipientFromInvoice. Open in
  // docs/security/PII-STORAGE.md; a new column here fails until it is decided.
  assert.deepEqual(columns, ['account_ref', 'bank_account_number', 'ciphertext']);
});
