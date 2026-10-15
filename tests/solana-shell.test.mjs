// Prompt 10 Phase 1: the dashboard shell. The sidebar is exactly §3.1's table; its badges come from
// the server's counts; the setup card hides when setup is done; the top row's search reads only the
// company's own records and never a full account number; the floating Zeke knows the page it is on,
// stays out of the way, never approves, and speaks up only when something waits.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';

import { badgeFor, isActive, NAV_GROUPS, setupCard } from '../lib/dashboard/nav.ts';
import { floatingZekeHiddenOn, ZEKE_PAGE_LABELS, zekeContextFor, zekeNudge } from '../lib/solana-zeke/context.ts';
import { resetRuntime } from '../lib/solana-app/runtime.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as svc from '../lib/solana-app/service.ts';
import { navCounts, navShell } from '../lib/solana-app/nav-counts.ts';
import { searchCompany, SEARCH_LIMIT } from '../lib/solana-app/search.ts';
import { giveDetails } from './helpers/transfer-details.mjs';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

const source = (p) => readFileSync(p, 'utf8');
const codeOnly = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('the sidebar is exactly §3.1: Overview, then Pay, Money, Contacts and Control', () => {
  const table = NAV_GROUPS.flatMap((g) => g.items.map((i) => [g.title ?? '(top)', i.label, i.href, i.badge ?? 'none']));
  assert.deepEqual(table, [
    ['(top)', 'Overview', '/dashboard', 'approvals'],
    ['Pay', 'Transfer', '/dashboard/transfer', 'none'],
    ['Pay', 'Invoices', '/dashboard/invoices', 'billsDue'],
    ['Pay', 'Batch payout', '/dashboard/batch', 'none'],
    ['Money', 'Balance', '/dashboard/fund', 'none'],
    ['Money', 'Treasury', '/dashboard/treasury', 'none'],
    ['Money', 'History', '/dashboard/history', 'none'],
    ['Contacts', 'Recipients', '/dashboard/recipients', 'unverified'],
    // Rules live in Settings (its Rules tab), not the sidebar (Sky, 15 Oct).
    ['Control', 'Zeke', '/dashboard/zeke', 'ai'],
  ]);
  // "Getting started" is gone: setup is a card that disappears, not a nav group.
  assert.ok(!NAV_GROUPS.some((g) => g.title === 'Getting started' || g.title === 'Payments'));
  assert.equal(isActive('/dashboard', '/dashboard/transfer'), false, 'Overview is active on /dashboard only');
  assert.equal(isActive('/dashboard/invoices', '/dashboard/invoices/pay'), true);
});

test('badges are the server counts, and a zero shows nothing', () => {
  const counts = { approvals: 2, billsDue7d: 3, unverifiedRecipients: true };
  assert.deepEqual(badgeFor('approvals', counts), { kind: 'count', text: '2', tone: 'coral', label: '2 payments need your approval' });
  assert.deepEqual(badgeFor('billsDue', counts), { kind: 'count', text: '3 due', tone: 'ink', label: '3 bills due within 7 days' });
  assert.deepEqual(badgeFor('unverified', counts), { kind: 'dot', label: 'a recipient is not verified' });
  assert.equal(badgeFor('approvals', { approvals: 0, billsDue7d: 0, unverifiedRecipients: false }), null);
  assert.equal(badgeFor('billsDue', null), null, 'no counts yet: no guess');
  assert.deepEqual(badgeFor('ai', null), { kind: 'tag', text: 'AI', label: 'an AI assistant' });
});

test('the setup card counts the real steps, names the next one, and disappears when all are done', () => {
  const steps = [
    { id: 'terms', title: 'Accept the terms', done: true },
    { id: 'profile', title: 'Business profile', done: true },
    { id: 'verify', title: 'Verify the business', done: true },
    { id: 'approvals', title: 'Approvals', done: true },
    { id: 'recipient', title: 'First recipient (optional)', done: false },
    { id: 'second_approver', title: 'Second approver (optional)', done: false },
  ];
  assert.deepEqual(setupCard(steps), { done: 4, total: 6, pct: 67, next: 'save your first recipient' });
  assert.equal(setupCard(steps.map((s) => ({ ...s, done: true }))), null);
  assert.equal(setupCard(null), null, 'no database: no card rather than a made-up count');
  // The setup page keeps the same steps, with the second approver last and optional.
  const onboarding = source('lib/server/onboarding.ts');
  assert.match(onboarding, /id: 'second_approver'/);
  assert.ok(onboarding.indexOf("id: 'second_approver'") > onboarding.indexOf("id: 'recipient'"), 'last');
});

test('nav counts: approvals waiting, bills due within 7 days, unverified recipients, from the company only', async () => {
  const env = await company();
  const empty = await navCounts(env.org.id);
  assert.deepEqual(empty, { approvals: 0, billsDue7d: 0, unverifiedRecipients: false });

  // A checked bill due in 3 days, from a new supplier nobody has verified yet.
  const now = new Date('2026-10-14T03:00:00Z');
  await bill(env.org.id, { dueDate: '2026-10-17' });
  await bill(env.org.id, { dueDate: '2026-11-30', invoiceNumber: 'INV-LATER' });
  const c = await navCounts(env.org.id, now);
  assert.equal(c.billsDue7d, 1, 'only the bill due within 7 days');
  assert.equal(c.unverifiedRecipients, true);

  // A quoted and checked transfer waits for approval.
  const inv = svc.startTransfer(env.org.id, { recipient: { name: 'Davao Packaging Corp.', bank: 'BPI', accountLast4: '0910' }, amountPhpMinor: '5000000', verification: { by: 'Aisyah', method: 'call-back' }, by: 'Aisyah' });
  giveDetails(env.org.id, inv.id);
  const p = await svc.quote(env.org.id, inv.id);
  const card = (await svc.paymentView(p.id)).cards[0];
  await svc.selectRoute(p.id, { quoteId: card.quoteId });
  assert.equal((await navCounts(env.org.id, now)).approvals, 1);

  // Another company sees none of it.
  const other = await company('Other Trading');
  assert.deepEqual(await navCounts(other.org.id, now), { approvals: 0, billsDue7d: 0, unverifiedRecipients: false });

  const shell = await navShell(env.org.id, now);
  assert.deepEqual(shell.rate, { pair: 'USD → PHP', rate: '57.40', label: 'test rate', next: ['USD → IDR'] });
});

test('search: own records only, by name, number or amount, at most 8 grouped, never a full account number', async () => {
  const env = await company();
  await bill(env.org.id, { dueDate: '2026-10-17' });
  const inv = svc.startTransfer(env.org.id, { recipient: { name: 'Davao Packaging Corp.', bank: 'BPI', accountLast4: '0910' }, amountPhpMinor: '5000000', verification: { by: 'Aisyah', method: 'call-back' }, by: 'Aisyah' });
  giveDetails(env.org.id, inv.id);
  await svc.quote(env.org.id, inv.id);

  // A saved recipient (saved after a verified payment; set here directly).
  svc.getOrg(env.org.id).suppliers.push({ name: 'Davao Packaging Corp.', bank: 'BPI', accountLast4: '0910', verified: { by: 'Aisyah', method: 'call-back', at: '2026-10-13T00:00:00Z' } });
  const byName = await searchCompany(env.org.id, 'davao');
  assert.deepEqual(byName.groups.map((g) => g.kind), ['payment', 'recipient']);
  assert.equal(byName.groups.find((g) => g.kind === 'recipient').results[0].detail, 'BPI •••• 0910');

  const byAmount = await searchCompany(env.org.id, '50,000');
  assert.ok(byAmount.groups.some((g) => g.kind === 'payment'), 'an amount finds the payment');

  const byNumber = await searchCompany(env.org.id, 'INV-0412');
  assert.ok(byNumber.groups.some((g) => g.kind === 'bill'));

  assert.equal((await searchCompany(env.org.id, 'a')).total, 0, 'two characters at least');
  const other = await company('Other Trading');
  assert.equal((await searchCompany(other.org.id, 'davao')).total, 0, 'another company finds nothing of ours');

  for (let i = 0; i < 12; i++) await bill(env.org.id, { dueDate: '2026-10-20', invoiceNumber: `INV-9${String(i).padStart(3, '0')}` });
  const many = await searchCompany(env.org.id, 'INV-9');
  assert.equal(many.total, SEARCH_LIMIT);

  // Nothing shown carries a full account number (Philippine accounts run 10 to 16 digits; a
  // transfer's reference, TRF-20261013-…, carries a date).
  const shown = [byName, byAmount, byNumber, many].flatMap((r) => r.groups.flatMap((g) => g.results.map((x) => `${x.title} ${x.detail}`)));
  for (const line of shown) assert.doesNotMatch(line, /\d{10,}/, line);
});

test('the floating Zeke knows the page, hides on the Zeke page, and nudges only when something waits', () => {
  assert.equal(zekeContextFor('/dashboard').label, 'Overview');
  assert.equal(zekeContextFor('/dashboard/transfer', '?step=3').label, 'Transfer · Step 3, quote');
  assert.equal(zekeContextFor('/dashboard/transfer', 'step=1&to=bank').label, 'Transfer · Step 1, recipient');
  assert.equal(zekeContextFor('/dashboard/transfer').label, 'Transfer');
  assert.equal(zekeContextFor('/dashboard/invoices').label, 'Invoices');
  assert.equal(zekeContextFor('/dashboard/invoices/pay').label, 'Invoices · Pay an invoice');
  assert.equal(zekeContextFor('/dashboard/invoices/get').label, 'Invoices · Get paid');
  assert.equal(zekeContextFor('/dashboard/treasury').label, 'Treasury');
  assert.equal(zekeContextFor('/dashboard/fund').label, 'Balance');
  assert.equal(zekeContextFor('/dashboard/history').label, 'History');
  assert.equal(zekeContextFor('/dashboard/batch').label, 'Batch payout');
  assert.equal(zekeContextFor('/dashboard/recipients').label, 'Recipients');
  assert.equal(zekeContextFor('/dashboard/settings/policy').label, 'Rules');
  assert.equal(zekeContextFor('/dashboard/settings').label, 'Settings');
  assert.equal(zekeContextFor('/dashboard/transfer', '?step=3').chips[0], 'Why is Cheapest cheaper?');
  assert.equal(zekeContextFor('/dashboard/treasury').chips[0], "What's idle above my reserve?");
  for (const p of ['/dashboard', '/dashboard/transfer', '/dashboard/fund']) assert.equal(zekeContextFor(p).chips.length, 3);
  // Every label the panel can send is on the server's allow-list, and none carries a digit run.
  for (const p of ['/dashboard', '/dashboard/zeke', '/dashboard/unknown', '/dashboard/invoices/get']) assert.ok(ZEKE_PAGE_LABELS.has(zekeContextFor(p).label));
  for (const l of ZEKE_PAGE_LABELS) assert.doesNotMatch(l, /\d{3,}/);

  assert.equal(floatingZekeHiddenOn('/dashboard/zeke'), true);
  assert.equal(floatingZekeHiddenOn('/dashboard'), false);
  assert.equal(zekeNudge(0), null);
  assert.equal(zekeNudge(1), '1 draft needs your approval');
  assert.equal(zekeNudge(3), '3 drafts need your approval');

  const floating = codeOnly(source('components/FloatingCopilot.tsx'));
  assert.doesNotMatch(floating, /NUDGES|Hi!|Can I help\?|Ready to splash it\?/, 'no small talk');
  assert.doesNotMatch(floating, /approveInChat|onApprove|Approve on this device|Sign & approve/, 'no approve control in the panel');
  assert.match(floating, /allowInlineApproval: false/);
  assert.match(floating, /useOverlayOpen\(\)/, 'hidden while a sheet or the approval moment is open');
  assert.match(floating, /floatingZekeHiddenOn\(pathname\)/, 'hidden on the Zeke page');
  assert.match(floating, /zekeNudge\(/);
  assert.match(floating, /Zeke can(?:&rsquo;|’|')t approve or move money, and it can be wrong\. Check before you approve\./);
});

/* ------------------------------------------------------------------ helpers */

async function company(name = 'Selangor Trading Sdn Bhd') {
  const { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } = await import('../lib/solana/device-key.ts');
  const { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } = await import('../lib/solana/recovery-kit.ts');
  const org = svc.createOrg({ companyName: name, personName: 'Aisyah' });
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
  await svc.createVault(org.id);
  await svc.fund(org.id);
  return { org, keys };
}

/** A bill Zeke read from the sample invoice and a person checked, with a chosen due date. */
async function bill(orgId, over = {}) {
  const { invoice } = await svc.readInvoiceDraft(orgId, { sample: true });
  const f = invoice.draft.fields;
  const fields = { invoiceNumber: f.invoiceNumber, supplierName: f.supplierName, supplierBank: f.supplierBank, supplierAccountLast4: f.supplierAccountLast4, amountPhpMinor: String(f.amountPhpMinor), dueDate: f.dueDate, ...over };
  svc.confirmInvoice(orgId, invoice.id, { fields, confirmed: invoice.draft.needsConfirmation, confirmedBy: 'Aisyah' });
  return invoice;
}
