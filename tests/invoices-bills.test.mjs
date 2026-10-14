// Prompt 10 §6.1–6.2: Invoices, the chooser and Pay an invoice.
//   - The chooser's counts come from server state, and hide at zero; the sidebar opens the chooser and
//     `?mode=` only redirects.
//   - Check the invoice: every field shows the line it came from; the account number is masked in the
//     document too, sealed, and shown only after a device step-up (owner or finance admin, 30 seconds).
//   - New bank details raise the panel and block paying until the call-back is recorded, and a number
//     printed on the invoice isn't a call-back.
//   - Confirm and pay hands over to Transfer's Step 3: one engine, one approval card.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { resetKms } from '../lib/server/kms/index.ts';
import { revealBankNumber, revealChallenge } from '../lib/server/bank-details.ts';
import { billCounts, billsView, checkView, dismissBill, payBill, recordCallBack } from '../lib/solana-app/bills.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore, store } from '../lib/solana-app/store.ts';
import { SAMPLE_INVOICE_TEXT } from '../lib/solana-zeke/fixtures/sample-invoice.ts';
import { loadTsx } from './helpers/render-tsx.mjs';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
  resetKms();
});

const FULL = '002188304471';
const OWNER = { isOwner: true, role: 'admin', hasDevice: true };

async function company(name = 'Selangor Trading Sdn Bhd') {
  const org = svc.createOrg({ companyName: name, personName: 'Aisyah Rahman' });
  const kit = deriveRecoveryKey(generateRecoveryWords());
  const keys = createMemoryDeviceKeyStore();
  const device = await createDeviceKey(keys, org.id);
  const proofs = [];
  for (const c of svc.issueChallenges(org.id, [{ role: 'device', publicKey: device.publicKey }, { role: 'kit', publicKey: kit.publicKey }])) {
    const signer = c.role === 'kit' ? kit : { sign: (m) => signWithDeviceKey(keys, org.id, m) };
    proofs.push({ role: c.role, publicKey: c.publicKey, nonce: c.nonce, signature: await signPossessionChallenge(signer, c) });
  }
  await svc.registerKeys(org.id, proofs);
  kit.destroy();
  const vault = await svc.createVault(org.id);
  await svc.fund(org.id);
  const sign = async (message) => bs58.encode(await signWithDeviceKey(keys, org.id, new TextEncoder().encode(message)));
  return { org, keys, device, vault, sign };
}

/** Everything a payload carries, as text: the full number must be nowhere in it. */
const text = (x) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

test('reading an invoice seals its account number and keeps the document masked; nothing returned carries it', async () => {
  const { org } = await company();
  const { invoice, text: shown } = await svc.readInvoiceDraft(org.id, { sample: true });
  assert.ok(invoice.accountSecretId, 'the number is sealed under the invoice');
  assert.equal(invoice.bankCode, 'BDO', 'its bank matched the partner’s list');
  assert.match(shown, /Account Number: •••• •••• 4471/, 'the document shows it masked');
  for (const where of [shown, text(invoice), text(svc.invoiceView(invoice)), text(await checkView(org.id, invoice.id, OWNER))]) {
    assert.doesNotMatch(where, /0021-8830-4471|002188304471/, 'no full number leaves the server');
  }
  const secret = await runtime().secrets.current(org.id, invoice.id);
  assert.equal(secret.last4, '4471');
  assert.equal(invoice.document.lines.length, SAMPLE_INVOICE_TEXT.trimEnd().split('\n').length, 'every line of the document, numbered from 1');
});

test('Check the invoice: every field names the line it came from, lit in the document; the bank lines are amber', async () => {
  const { org } = await company();
  const { invoice } = await svc.readInvoiceDraft(org.id, { sample: true });
  const c = await checkView(org.id, invoice.id, OWNER);
  assert.deepEqual(c.fields.map((f) => f.key), ['supplierName', 'invoiceNumber', 'dueDate', 'amountPhpMinor', 'supplierAccountLast4']);
  for (const f of c.fields) {
    assert.ok(Number.isInteger(f.line) && f.line > 0, `${f.key} has a source line`);
    assert.ok(c.highlights[String(f.line)], `line ${f.line} is lit`);
    assert.match(c.document[f.line - 1], f.key === 'amountPhpMinor' ? /560,000\.00/ : f.key === 'supplierAccountLast4' ? /•••• •••• 4471/ : /\S/);
  }
  assert.equal(c.highlights[String(c.bank.line)], 'bank', 'the account line is amber');
  assert.equal(c.fields.find((f) => f.key === 'amountPhpMinor').help.text, 'matches the two lines above it', 'the item lines add up to the total');
  assert.equal(c.fields.find((f) => f.key === 'invoiceNumber').help.text, 'not paid before');
  assert.equal(c.fields.find((f) => f.key === 'supplierName').help.text, 'new to you');
  assert.deepEqual({ masked: c.bank.masked, full: c.bank.full, mayReveal: c.bank.mayReveal }, { masked: '•••• •••• 4471', full: true, mayReveal: true });
  assert.equal((await checkView(org.id, invoice.id, { isOwner: false, role: 'maker', hasDevice: true })).bank.mayReveal, false, 'a maker is not offered "Show number"');
  assert.equal((await checkView(org.id, invoice.id, { isOwner: true, role: 'admin', hasDevice: false })).bank.mayReveal, false, 'nor anyone without a device');
});

test('"Show number" on an invoice: owner or finance admin, after a device step-up, for 30 seconds; others refused', async () => {
  const { org, device, sign } = await company();
  const { invoice } = await svc.readInvoiceDraft(org.id, { sample: true });
  const actor = (role) => ({ orgId: org.id, userId: `user_${role}`, isOwner: role === 'owner', role: role === 'owner' ? 'admin' : role, deviceKey: device.publicKey });
  const now = new Date('2026-10-14T03:00:00.000Z');
  const c = await revealChallenge(actor('owner'), invoice.id, now);
  assert.match(c.message, new RegExp(`recipient:${invoice.id}`));
  const shown = await revealBankNumber(actor('owner'), invoice.id, { nonce: c.nonce, signature: await sign(c.message) }, new Date(now.getTime() + 2_000));
  assert.equal(shown.accountNumber, FULL);
  assert.equal(Date.parse(shown.expiresAt) - (now.getTime() + 2_000), 30_000);
  await assert.rejects(revealChallenge(actor('maker'), invoice.id), (e) => e.status === 403);
  await assert.rejects(revealBankNumber(actor('owner'), invoice.id, { nonce: c.nonce, signature: await sign(c.message) }), (e) => e.status === 401, 'a challenge is single use');
  const other = await svc.readInvoiceDraft(svc.createOrg({ companyName: 'Other' }).id, { sample: true });
  await assert.rejects(revealChallenge(actor('owner'), other.invoice.id), (e) => e.status === 404, 'another company’s invoice is not found');
  const log = await runtime().secrets.reveals(org.id);
  assert.ok(log.some((e) => e.result === 'revealed' && e.beneficiaryId === invoice.id), 'every look is logged');
});

test('new bank details raise the panel and block paying until the call-back is recorded; a number on the invoice is refused', async () => {
  const { org } = await company();
  const withPhone = SAMPLE_INVOICE_TEXT.replace('TIN: 000-123-456-000', 'TIN: 000-123-456-000\nTel: +63 2 8812 3456').replace('INV-0412', 'INV-0500');
  const { invoice } = await svc.readInvoiceDraft(org.id, { text: withPhone, source: 'paste' });
  const before = await checkView(org.id, invoice.id, OWNER);
  assert.equal(before.panel.status, 'new');
  assert.equal(before.panel.verified, null);
  assert.equal((await billsView(org.id)).rows[0].status.label, 'New bank details · verify');

  const fields = { ...Object.fromEntries(Object.entries(invoice.draft.fields).map(([k, v]) => [k, String(v)])) };
  const all = invoice.draft.needsConfirmation;
  await assert.rejects(payBill(org.id, invoice.id, { by: 'Aisyah', fields, confirmed: all }), (e) => e.code === 'bank_details_unverified', 'no paying before the call-back');

  assert.throws(() => recordCallBack(org.id, invoice.id, { by: 'Aisyah', spokeTo: 'Rhea Santos', numberCalled: '(02) 8812-3456' }), (e) => e.code === 'number_on_invoice', 'a number printed on the invoice checks nothing');
  assert.throws(() => recordCallBack(org.id, invoice.id, { by: 'V', spokeTo: 'Rhea', numberCalled: '+63 2 8000 0000', role: 'viewer' }), (e) => e.status === 403, 'a viewer can’t');
  const v = recordCallBack(org.id, invoice.id, { by: 'Aisyah Rahman', spokeTo: 'Rhea Santos, accounts', numberCalled: '+63 2 8700 1100' });
  assert.deepEqual({ by: v.by, method: v.method, spokeTo: v.spokeTo, numberCalled: v.numberCalled }, { by: 'Aisyah Rahman', method: 'call-back', spokeTo: 'Rhea Santos, accounts', numberCalled: '+63 2 8700 1100' });
  const after = await checkView(org.id, invoice.id, OWNER);
  assert.equal(after.panel.verified.numberCalled, '+63 2 8700 1100');

  const p = await payBill(org.id, invoice.id, { by: 'Aisyah', fields, confirmed: all });
  assert.equal(p.kind, 'bank');
  assert.equal(p.state, 'quoted', 'the payment opens on Step 3, quoted');
  assert.equal(svc.getInvoice(org.id, invoice.id).confirmed.bankDetailsVerified.by, 'Aisyah Rahman', 'the call-back travels with the confirmed invoice');
  const again = await payBill(org.id, invoice.id, { by: 'Aisyah' });
  assert.equal(again.id, p.id, 'paying again re-quotes the same payment, never a second one');
});

test('a changed account names the old one and the new one', async () => {
  const { org } = await company();
  org.suppliers.push({ id: 'sup_mfs', name: 'Manila Freight Services Inc.', bank: 'BDO Unibank, Inc.', accountLast4: '7731', verified: { by: 'Aisyah', method: 'call-back', at: '2026-09-01T00:00:00.000Z' } });
  const { invoice } = await svc.readInvoiceDraft(org.id, { sample: true });
  const c = await checkView(org.id, invoice.id, OWNER);
  assert.equal(c.panel.status, 'changed');
  assert.deepEqual(c.panel.previous, { bank: 'BDO Unibank, Inc.', last4: '7731', masked: '•••• •••• 7731' });
  assert.equal(c.panel.asked.masked, '•••• •••• 4471');
  assert.equal(c.fields.find((f) => f.key === 'supplierName').help.text, 'a supplier you have paid before');
});

test('the inbox: To check, Ready to pay, Waiting for approval, Paid, each from the bill and its payment', async () => {
  const { org } = await company();
  const counts0 = await billCounts(org.id);
  assert.deepEqual(counts0, { check: 0, ready: 0, waiting: 0, paid: 0 }, 'a new company has nothing');
  const { invoice } = await svc.readInvoiceDraft(org.id, { sample: true });
  assert.equal((await billsView(org.id)).rows[0].tab, 'check');
  recordCallBack(org.id, invoice.id, { by: 'Aisyah', spokeTo: 'Rhea', numberCalled: '+63 2 8700 1100' });
  const fields = Object.fromEntries(Object.entries(invoice.draft.fields).map(([k, v]) => [k, String(v)]));
  const p = await payBill(org.id, invoice.id, { by: 'Aisyah', fields, confirmed: invoice.draft.needsConfirmation });
  let row = (await billsView(org.id)).rows[0];
  assert.deepEqual({ tab: row.tab, action: row.action.label }, { tab: 'ready', action: 'Continue' });
  assert.equal(row.action.href, `/dashboard/transfer?payment=${p.id}&step=quote`, 'it continues on Transfer’s Step 3');
  const view = await svc.paymentView(p.id);
  await svc.selectRoute(p.id, { quoteId: view.cards[0].quoteId });
  row = (await billsView(org.id)).rows[0];
  assert.deepEqual({ tab: row.tab, status: row.status.label, tone: row.status.tone, href: row.action.href }, { tab: 'waiting', status: 'Waiting for approval', tone: 'coral', href: `/dashboard/transfer?payment=${p.id}&step=approve` });
  assert.deepEqual(await billCounts(org.id), { check: 0, ready: 0, waiting: 1, paid: 0 });
});

test('due dates within three days, and past them, are amber; "Not this one" takes a bill out of the inbox', async () => {
  const { org } = await company();
  const { invoice } = await svc.readInvoiceDraft(org.id, { sample: true });
  const due = invoice.draft.fields.dueDate; // 2026-10-30
  const at = (iso) => new Date(`${iso}T08:00:00.000Z`);
  assert.deepEqual((await billsView(org.id, at('2026-10-20'))).rows[0].due, { label: 'Due 30 Oct', tone: null });
  assert.deepEqual((await billsView(org.id, at('2026-10-27'))).rows[0].due, { label: 'Due 30 Oct · in 3 days', tone: 'amber' });
  assert.deepEqual((await billsView(org.id, at('2026-11-01'))).rows[0].due, { label: 'Overdue · 2 days', tone: 'amber' });
  assert.equal(due, '2026-10-30');
  await dismissBill(org.id, invoice.id, 'Aisyah');
  assert.equal((await billsView(org.id)).rows.length, 0);
});

test('the chooser shows server counts and hides a count at zero', async () => {
  const { InvoicesChooserView } = await loadTsx('components/solana/invoices/InvoicesChooser.tsx');
  const zero = renderToStaticMarkup(createElement(InvoicesChooserView, { summary: { pay: { toCheck: 0, ready: 0, waiting: 0 }, get: { unpaid: 0, overdue: 0 } } }));
  assert.doesNotMatch(zero, /to check|waiting for approval|unpaid|overdue/, 'nothing at zero');
  assert.match(zero, /href="\/dashboard\/invoices\/get"/);
  assert.match(zero, /href="\/dashboard\/invoices\/pay"/);
  const some = renderToStaticMarkup(createElement(InvoicesChooserView, { summary: { pay: { toCheck: 3, ready: 0, waiting: 1 }, get: { unpaid: 2, overdue: 1 } } }));
  for (const words of ['3 to check', '1 waiting for approval', '2 unpaid requests', '1 overdue']) assert.ok(some.includes(words), words);
  assert.doesNotMatch(some, /0 ready to pay/);
});

test('the sidebar opens the chooser; ?mode= only redirects, and old links still land', async () => {
  const { NAV_GROUPS } = await import('../lib/dashboard/nav.ts');
  const invoices = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.label === 'Invoices');
  assert.equal(invoices.href, '/dashboard/invoices', 'the sidebar item always opens the chooser');
  const { default: Page } = await loadTsx('app/dashboard/invoices/page.tsx');
  const where = async (sp) => {
    try {
      await Page({ searchParams: Promise.resolve(sp) });
      return null;
    } catch (e) {
      return String(e.digest ?? e.message).split(';')[2] ?? String(e.digest);
    }
  };
  assert.equal(await where({ mode: 'pay' }), '/dashboard/invoices/pay');
  assert.equal(await where({ mode: 'get' }), '/dashboard/invoices/get');
  assert.equal(await where({ payment: 'pay_0123456789abcdef' }), '/dashboard/transfer?payment=pay_0123456789abcdef');
  assert.equal(await where({ invoice: 'inv_0123456789abcdef' }), '/dashboard/invoices/pay?invoice=inv_0123456789abcdef');
  assert.equal(await where({}), null, 'no mode: the chooser itself');
  assert.equal(await where({ mode: 'other' }), null);
});

test('no stored copy of a bill keeps a full number: the store holds only the masked document', async () => {
  const { org } = await company();
  await svc.readInvoiceDraft(org.id, { sample: true });
  assert.doesNotMatch(text([...store().invoices.values()]), /002188304471|0021-8830-4471/);
});
