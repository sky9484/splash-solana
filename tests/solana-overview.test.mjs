// Prompt 10 Phase 2: Overview from one typed read. Stations: every state at exactly one station.
// Needs you: ranked, at most five, an honest empty state. The aggregator: integers only, the reserve
// maths from lib/treasury/reserve.ts, nothing from another company.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { PAYMENT_STATES } from '../lib/solana-app/payment-machine.ts';
import { resetRuntime } from '../lib/solana-app/runtime.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as svc from '../lib/solana-app/service.ts';
import { pipelineFor, stationLabel, stationOf, STATIONS } from '../lib/solana-app/stations.ts';
import { needsYou, NEEDS_LIMIT } from '../lib/solana-app/needs-you.ts';
import { bpsText, overviewFor, phpToUsdMinor } from '../lib/solana-app/overview.ts';
import { formatPhp, formatUsd } from '../lib/solana-zeke/router.ts';
import { resolvesToPage } from './helpers/app-routes.mjs';
import { giveDetails } from './helpers/transfer-details.mjs';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

test('stations: every payment state maps to exactly one station, for a bank payout, a Splash business and treasury', () => {
  const ids = new Set(STATIONS.map((s) => s.id));
  for (const kind of ['bank', 'peer', 'treasury']) {
    for (const s of PAYMENT_STATES) {
      const at = stationOf(s, kind);
      assert.ok(ids.has(at), `${kind}: ${s} → ${at}`);
    }
  }
  // §5.8's table.
  assert.equal(stationOf('proposed'), 'waiting');
  assert.equal(stationOf('checked'), 'waiting');
  assert.equal(stationOf('approved'), 'sent');
  assert.equal(stationOf('executed'), 'sent');
  assert.equal(stationOf('confirmed', 'bank'), 'partner');
  assert.equal(stationOf('partner_paid', 'bank'), 'paid');
  assert.equal(stationOf('confirmed', 'peer'), 'paid');
  assert.equal(stationOf('confirmed', 'treasury'), 'paid');
  assert.equal(stationOf('evidenced'), 'recording');
  assert.equal(stationOf('anchored'), 'recorded');
  assert.equal(stationLabel('paid', 'bank'), 'Paid to bank');
  assert.equal(stationLabel('paid', 'peer'), 'In their account');
  assert.equal(stationLabel('paid', 'treasury'), 'In Investments');
  assert.deepEqual(pipelineFor('bank'), ['waiting', 'sent', 'partner', 'paid', 'recording', 'recorded']);
  assert.deepEqual(pipelineFor('peer'), ['waiting', 'sent', 'paid', 'recording', 'recorded'], 'no partner leg between Splash businesses');
});

const now = new Date('2026-10-13T02:00:00Z');
const inSec = (s) => new Date(now.getTime() + s * 1000).toISOString();
const base = { now, approvals: [], verifications: [], dueSoon: [], overdue: [], sweep: null, setup: [], php: formatPhp, usd: formatUsd };

test('needs you: approvals with a live quote first, then verifications, bills due, requests, a sweep, setup', () => {
  const r = needsYou({
    ...base,
    setup: [{ id: 'second_approver', title: 'Add a second approver', href: '/dashboard/settings/devices' }],
    sweep: { kind: 'subscribe', amount: 'US$14,987.50', href: '/dashboard/treasury?sheet=sweep' },
    overdue: [{ payer: 'Penang Components', amount: 'US$8,200.00', daysOverdue: 5, reference: 'SEL-0091', href: '/dashboard/invoices/get' }],
    dueSoon: [
      { supplierName: 'Davao Agri Supply', dueDate: '2026-10-17', dueLabel: '17 Oct', amountPhpMinor: 12_500_000n },
      { supplierName: 'Luzon Logistics', dueDate: '2026-10-16', dueLabel: '16 Oct', amountPhpMinor: 28_750_000n },
    ],
    verifications: [{ invoiceId: 'inv_1', supplierName: 'Cebu Packaging', bank: 'BPI', last4: '2290', href: '/x' }],
    approvals: [
      { paymentId: 'pay_old', supplierName: 'Old Quote Co', reference: 'INV-1', theyGet: '₱1.00', youPay: 'US$0.02', quoteExpiresAt: inSec(-30), href: '/a' },
      { paymentId: 'pay_live', supplierName: 'Manila Freight', reference: 'INV-0415', theyGet: '₱287,000.00', youPay: 'US$5,012.50', quoteExpiresAt: inSec(48), href: '/b' },
    ],
  });
  assert.equal(r.total, 7);
  assert.equal(r.rows.length, NEEDS_LIMIT, 'at most five rows; the rest behind "See all"');
  assert.deepEqual(r.more.map((x) => x.kind), ['sweep', 'setup'], '"See all" opens the rest, still ranked');
  assert.equal(r.rows[3].action.href, '/dashboard/invoices/pay', 'bills due open Pay an invoice (lib/dashboard/links.ts, prompt 10 Phase 4)');
  assert.deepEqual(r.rows.map((x) => x.kind), ['approve', 'approve', 'verify', 'due', 'overdue']);
  assert.equal(r.rows[0].title, 'Manila Freight · ₱287,000.00', 'the live quote first');
  assert.equal(r.rows[0].quote.fresh, true);
  assert.match(r.rows[1].detail, /Quote expired · refreshes when you open it/);
  assert.equal(r.rows[2].title, 'Cebu Packaging changed bank details');
  assert.match(r.rows[2].detail, /Now BPI ••••2290/);
  assert.equal(r.rows[3].title, '2 invoices · ₱412,500.00');
  assert.equal(r.rows[3].detail, 'Luzon Logistics, 16 Oct · Davao Agri Supply, 17 Oct', 'soonest first');
  assert.equal(r.rows[0].tag.tone, 'coral');
  assert.equal(r.rows[2].tag.tone, 'amber');
  for (const row of r.rows) assert.doesNotMatch(`${row.title} ${row.detail} ${row.tag.label}`, /KYB|\bApproved\b/);
});

test('needs you: a bill asked in US dollars is summed in US dollars, never as ₱0.00', () => {
  const kms = { supplierName: 'Kuching Marine Supply', dueDate: '2026-10-17', dueLabel: '17 Oct', amountPhpMinor: 0n, amountUsdMinor: 100_000_000n };
  const davao = { supplierName: 'Davao Agri Supply', dueDate: '2026-10-16', dueLabel: '16 Oct', amountPhpMinor: 12_500_000n };
  assert.equal(needsYou({ ...base, dueSoon: [kms] }).rows[0].title, '1 invoice · US$100.00');
  assert.equal(needsYou({ ...base, dueSoon: [kms, davao] }).rows[0].title, '2 invoices · ₱125,000.00 and US$100.00');
  assert.equal(needsYou({ ...base, dueSoon: [davao] }).rows[0].title, '1 invoice · ₱125,000.00');
});

test('needs you: nothing waiting is an honest empty list', () => {
  assert.deepEqual(needsYou(base), { rows: [], more: [], total: 0 });
});

test('money helpers: PHP to US dollars at the test rate rounds up; all-in as a percent from integers', () => {
  // ₱287,000.00 at 57.40 = US$5,000.00 exactly.
  assert.equal(phpToUsdMinor(28_700_000n), 5_000_000_000n);
  // A centavo that doesn't divide rounds up, never down (a bill is never under-reserved).
  assert.equal(phpToUsdMinor(1n), 175n);
  assert.equal(bpsText(2_700n), '0.27%');
  assert.equal(bpsText(2_549n), '0.25%');
  assert.equal(bpsText(0n), '0.00%');
});

test('the overview aggregator: integer totals, covered, waiting, the pipeline, recent rows, and nothing from another company', async () => {
  const env = await company();
  const empty = await overviewFor({ orgId: env.org.id, now, companyCheck: 'ACTIVE', setupOpen: [] });
  assert.equal(empty.money.paymentsMinor, svc.OFFLINE_FUND_MINOR);
  assert.equal(empty.money.totalMinor, empty.money.paymentsMinor + empty.money.reserveMinor + empty.money.investmentsMinor);
  assert.equal(typeof empty.money.totalMinor, 'bigint');
  assert.equal(empty.money.investmentsSetUp, false, 'Investments wait for Phase 5');
  assert.equal(empty.money.covered, true);
  assert.equal(empty.needs.total, 0);
  assert.equal(empty.recent.length, 0);
  assert.deepEqual(empty.checks.companyCheck, { tone: 'ok', label: 'Verified' });
  assert.equal(empty.pipeline.length, 6);
  assert.ok(empty.pipeline.every((s) => s.count === 0 && !s.moving), 'nothing moving: every wire quiet');

  // A transfer quoted and checked: it waits for approval, and its "You pay" is what is waiting.
  const inv = svc.startTransfer(env.org.id, { recipient: { name: 'Davao Packaging Corp.', bank: 'BPI', accountLast4: '0910' }, amountPhpMinor: '5000000', verification: { by: 'Aisyah', method: 'call-back' }, by: 'Aisyah' });
  giveDetails(env.org.id, inv.id);
  const p = await svc.quote(env.org.id, inv.id);
  const card = (await svc.paymentView(p.id)).cards[0];
  await svc.selectRoute(p.id, { quoteId: card.quoteId });
  const o = await overviewFor({ orgId: env.org.id, now: new Date(), companyCheck: 'KYB_SUBMITTED', setupOpen: [{ id: 'second_approver', title: 'Add a second approver', href: '/dashboard/settings/devices' }] });
  const youPay = (await svc.getPayment(p.id)).approval.youPayUsdcMinor;
  assert.equal(o.money.waitingMinor, youPay);
  assert.equal(o.needs.rows[0].kind, 'approve');
  assert.equal(o.needs.rows.at(-1).kind, 'setup');
  assert.equal(o.pipeline.find((s) => s.id === 'waiting').count, 1);
  assert.equal(o.recent[0].tag.label, 'Waiting approval');
  assert.ok(o.recent[0].reviewHref, 'a waiting payment links to its review');
  assert.deepEqual(o.checks.companyCheck, { tone: 'amber', label: 'In review' });
  // Every link the aggregator hands the page lands on a page.
  const links = [...o.needs.rows, ...o.needs.more].map((r) => r.action.href).concat(o.pipeline.map((s) => s.href), o.recent.flatMap((r) => [r.receiptHref, r.reviewHref]).filter(Boolean));
  assert.deepEqual(links.filter((h) => !resolvesToPage(h)), [], 'no link to a missing page');
  assert.equal(o.checks.secondApproverBuilt, false, 'Planned until it is built');

  const other = await company('Other Trading');
  const theirs = await overviewFor({ orgId: other.org.id, now: new Date(), companyCheck: null, setupOpen: [] });
  assert.equal(theirs.recent.length, 0);
  assert.equal(theirs.needs.total, 0);
  assert.deepEqual(theirs.checks.companyCheck, { tone: 'ink', label: 'Not read' });
});

async function company(name = 'Selangor Trading Sdn Bhd') {
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
