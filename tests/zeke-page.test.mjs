// Prompt 10 §7A: the Zeke page. Its counters, "Waiting for you" and "Today" come from the company's own
// state (lib/solana-app/zeke-desk.ts); nothing on the page approves anything; the floating Zeke steps
// aside here; and the old desk's jargon ("Tool boundary", "Circuit breaker", "Proposals") is gone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { resetKms } from '../lib/server/kms/index.ts';
import { payBill, recordCallBack } from '../lib/solana-app/bills.ts';
import * as inv from '../lib/solana-app/investments.ts';
import { resetRuntime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import { zekeDeskView } from '../lib/solana-app/zeke-desk.ts';
import { ZEKE_AUTHORITY } from '../lib/solana-zeke/guard.ts';
import { floatingZekeHiddenOn } from '../lib/solana-zeke/context.ts';
import { safetyLines, ZEKE_ROSTER } from '../lib/solana-zeke/roster.ts';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
  resetKms();
});

async function company() {
  const org = svc.createOrg({ companyName: 'Selangor Trading Sdn Bhd', personName: 'Aisyah Rahman' });
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
  return { org, keys, device };
}

test('a new company: no drafts, nothing needs you, no notices, nothing today', async () => {
  const { org } = await company();
  const d = await zekeDeskView(org.id);
  assert.deepEqual(d.counters, { draftsToday: 0, needYou: 0, notices: 0 });
  assert.deepEqual(d.waiting, []);
  assert.deepEqual(d.today, []);
  assert.equal(d.chips[0], 'What’s due this week?');
});

test('the counters, "Waiting for you" and "Today" follow what Zeke read, flagged and drafted', async () => {
  const { org } = await company();
  // A supplier paid before, now asking to be paid into a new account: Zeke reads it and flags it.
  org.suppliers.push({ id: 'sup_mfs', name: 'Manila Freight Services Inc.', bank: 'BDO Unibank, Inc.', accountLast4: '7731', verified: { by: 'Aisyah', method: 'call-back', at: '2026-09-01T00:00:00.000Z' } });
  const { invoice } = await svc.readInvoiceDraft(org.id, { sample: true });
  let d = await zekeDeskView(org.id);
  assert.deepEqual(d.counters, { draftsToday: 0, needYou: 0, notices: 1 });
  assert.equal(d.waiting.length, 1);
  assert.equal(d.waiting[0].kind, 'verify');
  assert.match(d.waiting[0].title, /· new bank details$/);
  assert.equal(d.waiting[0].href, `/dashboard/invoices/pay?invoice=${invoice.id}`);
  assert.deepEqual(d.today.map((e) => e.what).sort(), ['Flagged new bank details', 'Read an invoice']);
  assert.match(d.today.find((e) => e.what === 'Flagged new bank details').detail, /waiting for a call-back$/);

  // The call-back is recorded and the bill is paid through Transfer: a draft Zeke made, waiting for approval.
  recordCallBack(org.id, invoice.id, { by: 'Aisyah', spokeTo: 'Rhea', numberCalled: '+63 2 8700 1100' });
  const fields = Object.fromEntries(Object.entries(invoice.draft.fields).map(([k, v]) => [k, String(v)]));
  const p = await payBill(org.id, invoice.id, { by: 'Aisyah', fields, confirmed: invoice.draft.needsConfirmation });
  const view = await svc.paymentView(p.id);
  await svc.selectRoute(p.id, { quoteId: view.cards[0].quoteId });
  d = await zekeDeskView(org.id);
  assert.deepEqual(d.counters, { draftsToday: 1, needYou: 1, notices: 0 });
  assert.equal(d.waiting[0].kind, 'approve');
  assert.equal(d.waiting[0].href, `/dashboard/transfer?payment=${p.id}`);
  assert.ok(d.waiting[0].amountMinor > 0n);
  const drafted = d.today.find((e) => e.what === 'Drafted a payment');
  assert.match(drafted.detail, /· waiting for your approval$/);
  assert.match(d.today.find((e) => e.what === 'Flagged new bank details').detail, /checked by call-back$/);
  assert.match(d.chips[0], /^Explain the .+ quote$/);
});

test('a waiting sweep draft is one row, and counts as a draft today', async () => {
  const { org } = await company();
  inv.setSweepRule(org.id, { on: true }, { isOwner: true, name: 'Aisyah' });
  const draft = await inv.draftSweep(org.id);
  const d = await zekeDeskView(org.id);
  assert.equal(d.counters.draftsToday, 1);
  const row = d.waiting.find((w) => w.kind === 'sweep');
  assert.deepEqual({ title: row.title, amount: row.amountMinor, href: row.href }, { title: 'Into T-bills, from your rule', amount: draft.amountMinor, href: `/dashboard/treasury?sweep=${draft.id}` });
  assert.match(d.today.find((e) => e.what === 'Drafted a sweep').detail, /into T-bills, from your owner’s rule$/);
});

test('"Today" is the company’s day in Malaysia, not UTC', async () => {
  const { org } = await company();
  await svc.readInvoiceDraft(org.id, { sample: true });
  const read = (await zekeDeskView(org.id)).today[0];
  const at = Date.parse(read.at);
  // A day later (in Malaysia) the read is no longer today's; a minute later it still is.
  const nextKlDay = new Date(at + 24 * 3_600_000);
  assert.equal((await zekeDeskView(org.id, nextKlDay)).today.length, 0);
  assert.equal((await zekeDeskView(org.id, new Date(at + 60_000))).today.length, 1);
});

test('the roster and the safety card are read from the code', () => {
  assert.deepEqual(ZEKE_ROSTER.map((r) => r.part), ['Reader', 'Router', 'Checker', 'Planner', 'Matcher', 'Auditor', 'Data spend']);
  assert.equal(ZEKE_ROSTER.find((r) => r.part === 'Planner').status, 'Built', 'sweep drafts exist since Phase 5');
  assert.equal(ZEKE_ROSTER.find((r) => r.part === 'Data spend').status, 'Planned');
  for (const r of ZEKE_ROSTER) assert.match(r.never, /^Never /);
  // "It can only read and draft" appears only while the code says so.
  assert.equal(ZEKE_AUTHORITY.canApprove, false);
  assert.equal(safetyLines('ready')[0], 'It can only read and draft. It can’t approve, pay or change a rule.');
  assert.match(safetyLines('on').join(' '), /Emergency stop is on/);
});

test('nothing on the Zeke page approves anything, the floating Zeke steps aside, and the old jargon is gone', () => {
  const page = readFileSync(new URL('../app/dashboard/zeke/ZekeDesk.tsx', import.meta.url), 'utf8');
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /allowInlineApproval: false/);
  assert.doesNotMatch(code, /approveInChat|onApprove|ActionCard|ThreadRow|\/approve['`]/, 'no approve path from the page');
  for (const m of code.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)) assert.doesNotMatch(m[1], /approve/i, `a button reads "${m[1].trim()}"`);
  assert.match(code, /You approve in Transfer, on your device\. Zeke can&rsquo;t\./);
  assert.doesNotMatch(code, /Tool boundary|Circuit breaker|Proposals|Maker-checker|Finance command desk/);
  assert.equal(floatingZekeHiddenOn('/dashboard/zeke'), true);
  // The AI tag is its own element, never the assistant's name.
  assert.match(code, /\{assistantName\} <Tag tone="ink">AI<\/Tag>/);
});
