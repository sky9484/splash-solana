// Prompt 11 Phase 4, "Smart Treasury", through the services with a fake clock: "Not now" holds sweep-out
// back for 7 days; the quarter's interest is drafted once, from the first business day after the
// quarter ends, at US$50 or more, drafted only; "Fees kept inside Splash" is the sum of the fee each
// inside-Splash payment recorded when it was quoted; and the live "Interest today" float never reaches
// a money path. Integers everywhere else.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';

import { liveEstimate } from '../components/solana/treasury/live.ts';
import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import * as inv from '../lib/solana-app/investments.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import { bookedPrice, interestBetween } from '../lib/treasury/history.ts';
import { TBILLS } from '../lib/treasury/reference.ts';
import { loadTsx } from './helpers/render-tsx.mjs';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

const $ = (dollars, cents = 0) => BigInt(dollars) * 1_000_000n + BigInt(cents) * 10_000n;
const DAY = 86_400_000;
const OWNER = { isOwner: true, name: 'Aisyah' };
/** The day the rate is dated: the booked price is the test price, and every figure is fresh. */
const ANCHOR = new Date(`${TBILLS.rate.asOf}T09:00:00Z`);

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
  const vault = await svc.createVault(org.id);
  return { org, keys, vault, deviceKey: device.publicKey };
}

async function placeOrder(env, req, now) {
  const { order, message } = await inv.prepareOrder(env.org.id, req, 'Aisyah', now);
  const signature = bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new TextEncoder().encode(message)));
  return inv.approveOrder(env.org.id, order.id, { signature, who: 'Aisyah', deviceKey: env.deviceKey }, now);
}

test('7 days / 30 days changes the tiles: This period and Average a day are the sums of the days shown', async () => {
  const { chartTiles } = await loadTsx('components/solana/treasury/InterestChart.tsx');
  // 30 booked days: 23 older days of US$1.00 and the last 7 of US$2.50 (US$ minor units, 6 decimals).
  const days = Array.from({ length: 30 }, (_, i) => ({ day: `d${i}`, interestMinor: String(i < 23 ? 1_000_000 : 2_500_000) }));
  const seven = chartTiles(days, '7');
  const thirty = chartTiles(days, '30');
  assert.equal(seven.shown.length, 7);
  assert.equal(thirty.shown.length, 30);
  assert.equal(seven.total, 7n * 2_500_000n);
  assert.equal(thirty.total, 23n * 1_000_000n + 7n * 2_500_000n);
  assert.equal(seven.average, 2_500_000n);
  assert.equal(thirty.average, (23n * 1_000_000n + 7n * 2_500_000n) / 30n, 'rounded down, an integer');
  assert.notEqual(seven.total, thirty.total);
  assert.notEqual(seven.average, thirty.average);
});

test('"Not now": the draft is set aside, nothing moves, and sweep-out isn’t drafted again for 7 days', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  inv.setSweepRule(env.org.id, { on: true }, OWNER, ANCHOR);
  const day1 = new Date('2026-10-14T01:00:00Z');
  const first = await inv.draftSweep(env.org.id, day1);
  assert.equal(first.kind, 'subscribe');
  const paymentsBefore = await runtime().chain.getUsdcBalance(env.vault.vaultPda);
  const set = inv.dismissSweepDraft(env.org.id, first.id, { name: 'Aisyah' }, new Date('2026-10-14T02:00:00Z'));
  assert.equal(set.state, 'dismissed');
  assert.deepEqual(set.dismissed, { by: 'Aisyah', at: '2026-10-14T02:00:00.000Z' });
  assert.equal(await runtime().chain.getUsdcBalance(env.vault.vaultPda), paymentsBefore, 'nothing moved');
  assert.throws(() => inv.dismissSweepDraft(env.org.id, first.id, { name: 'Aisyah' }), (e) => e.code === 'wrong_state', 'only a waiting draft');
  // The rest of that day, and the next six: no new sweep-out draft.
  for (const at of ['2026-10-14T20:00:00Z', '2026-10-15T01:00:00Z', '2026-10-20T01:00:00Z', '2026-10-21T01:59:00Z']) {
    assert.equal(await inv.draftSweep(env.org.id, new Date(at)), null, at);
  }
  assert.equal(inv.snoozedUntil(svc.getOrg(env.org.id), new Date('2026-10-20T00:00:00Z')), '2026-10-21T02:00:00.000Z');
  // Seven days after "Not now": Zeke asks again.
  const again = await inv.draftSweep(env.org.id, new Date('2026-10-21T03:00:00Z'));
  assert.equal(again?.kind, 'subscribe');
  assert.notEqual(again.id, first.id);
  // The view shows the decided row, then the new one.
  const v = await inv.treasuryView(env.org.id, OWNER, new Date('2026-10-21T03:00:00Z'));
  assert.deepEqual(v.sweep.rows.map((r) => [r.purpose, r.state]), [['sweep', 'drafted']]);
  const vDay1 = await inv.treasuryView(env.org.id, OWNER, new Date('2026-10-14T05:00:00Z'));
  assert.deepEqual(vDay1.sweep.rows.map((r) => [r.purpose, r.state]), [['sweep', 'dismissed']]);
  // Zeke says why nothing waits: "Not now", and until when (not "nothing needs drafting").
  assert.equal(vDay1.zeke, 'You said not now to today’s sweep, so I won’t draft one into T-bills again before 21 Oct. I never pick an investment for you.');
  const vDay3 = await inv.treasuryView(env.org.id, OWNER, new Date('2026-10-16T05:00:00Z'));
  assert.equal(vDay3.zeke, 'You said not now to a sweep, so I won’t draft one into T-bills again before 21 Oct. I never pick an investment for you.');
  assert.match(v.zeke, /^I drafted a sweep of US\$[\d,.]+ into T-bills/);
  assert.equal(svc.getOrg(env.org.id).investments?.orders.length ?? 0, 0, 'no order was placed');
});

test('the quarter’s interest: drafted once, from the first business day after the quarter, at US$50 or more, drafted only, beside the daily sweep', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER, ANCHOR);
  const sub = await placeOrder(env, { asset: 'usdy', kind: 'subscribe', amountMinor: $(20_000) }, ANCHOR);
  assert.equal(sub.state, 'settled');
  inv.setSweepRule(env.org.id, { on: true }, OWNER, ANCHOR);
  // Q4 2026 ends on Thursday 31 Dec; 1 Jan 2027 is a Friday (public holidays aren't known here).
  await inv.draftSweep(env.org.id, new Date('2026-12-31T22:00:00Z'));
  const org = svc.getOrg(env.org.id);
  const quarterDrafts = () => org.sweepDrafts.filter((d) => d.purpose === 'quarter_interest');
  assert.ok(quarterDrafts().every((d) => d.quarter !== '2026-Q4'), 'nothing for Q4 before Q4 has ended');
  const jan1 = new Date('2027-01-01T01:00:00Z');
  await inv.draftSweep(env.org.id, jan1);
  const q4 = quarterDrafts().filter((d) => d.quarter === '2026-Q4');
  assert.equal(q4.length, 1);
  const d = q4[0];
  const events = inv.unitsEventsOf(org);
  const booked = interestBetween('2026-10-01', '2026-12-31', events);
  assert.equal(d.kind, 'redeem');
  assert.equal(d.reason, 'quarter_interest');
  assert.equal(d.months, 'Oct–Dec');
  assert.equal(d.state, 'drafted', 'drafted only');
  assert.equal(d.amountMinor, (booked / 10_000n) * 10_000n, 'the interest booked that quarter, in whole cents');
  assert.ok(d.amountMinor >= $(50));
  // Once a quarter: the same draft later that day and the next days, never a second.
  await inv.draftSweep(env.org.id, new Date('2027-01-01T20:00:00Z'));
  await inv.draftSweep(env.org.id, new Date('2027-01-04T01:00:00Z'));
  assert.equal(quarterDrafts().filter((x) => x.quarter === '2026-Q4').length, 1);
  // It doesn't count against the daily sweep: both can wait on the same day.
  const v = await inv.treasuryView(env.org.id, OWNER, new Date('2027-01-04T02:00:00Z'));
  assert.ok(v.sweep.rows.some((r) => r.purpose === 'quarter_interest' && r.state === 'drafted' && r.months === 'Oct–Dec'));
  // Nothing was redeemed: the holding is what it was.
  assert.equal(org.investments.orders.filter((o) => o.kind === 'redeem').length, 0);
  // Overview's Needs you lists it, and its Review opens that draft on Treasury.
  const { overviewFor } = await import('../lib/solana-app/overview.ts');
  const o = await overviewFor({ orgId: env.org.id, companyCheck: 'ACTIVE', setupOpen: [], now: new Date('2027-01-04T02:00:00Z') });
  const rows = [...o.needs.rows, ...o.needs.more].filter((r) => /^Interest drafted/.test(r.title));
  assert.equal(rows.length, 1);
  assert.match(rows[0].title, /^Interest drafted · US\$[\d,]+\.\d\d back from T-bills$/);
  assert.match(rows[0].detail, /^Last quarter’s interest \(Oct–Dec\)\. Nothing moves until a person approves it\.$/);
  assert.equal(rows[0].action.href, `/dashboard/treasury?sweep=${d.id}`);
  // "Not now" on it: not drafted again this quarter.
  inv.dismissSweepDraft(env.org.id, d.id, { name: 'Aisyah' }, new Date('2027-01-04T03:00:00Z'));
  await inv.draftSweep(env.org.id, new Date('2027-01-05T01:00:00Z'));
  assert.equal(quarterDrafts().filter((x) => x.quarter === '2026-Q4').length, 1);
  // Hold drafts nothing at all.
  inv.setSweepRule(env.org.id, { on: false }, OWNER, new Date('2027-04-01T00:00:00Z'));
  await inv.draftSweep(env.org.id, new Date('2027-04-01T01:00:00Z'));
  assert.ok(quarterDrafts().every((x) => x.quarter !== '2027-Q1'));
});

test('a quarter’s interest under US$50 drafts nothing (its own minimum, not the US$500 sweep minimum)', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER, ANCHOR);
  await placeOrder(env, { asset: 'usdy', kind: 'subscribe', amountMinor: $(1_000) }, ANCHOR);
  inv.setSweepRule(env.org.id, { on: true }, OWNER, ANCHOR);
  await inv.draftSweep(env.org.id, new Date('2027-01-01T01:00:00Z'));
  assert.ok(svc.getOrg(env.org.id).sweepDrafts.every((d) => d.purpose !== 'quarter_interest'));
});

test('the chart is booked interest: 30 integer days, and the tiles are their sums', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER, ANCHOR);
  await placeOrder(env, { asset: 'usdy', kind: 'subscribe', amountMinor: $(20_000) }, ANCHOR);
  const now = new Date(ANCHOR.getTime() + 20 * DAY);
  const v = await inv.treasuryView(env.org.id, OWNER, now);
  assert.equal(v.tbills.interest.length, 30);
  for (const d of v.tbills.interest) assert.equal(typeof d.interestMinor, 'bigint');
  const events = inv.unitsEventsOf(svc.getOrg(env.org.id));
  const sum30 = v.tbills.interest.reduce((n, d) => n + d.interestMinor, 0n);
  assert.equal(sum30, interestBetween(v.tbills.interest[0].day, v.tbills.interest.at(-1).day, events));
  assert.ok(sum30 > 0n);
  // The day it settled gains nothing; every day after does.
  assert.equal(v.tbills.interest.find((d) => d.day === TBILLS.rate.asOf).interestMinor, 0n);
  assert.equal(v.tbills.quarterSoFarMinor, interestBetween('2026-10-01', v.tbills.interest.at(-1).day, events));
  // What the live estimate starts from: today's booked price and the units held.
  assert.equal(v.tbills.live.priceTodayMinor, bookedPrice(v.tbills.interest.at(-1).day));
  // Activity: interest booked and the move in, newest first.
  assert.equal(v.activity[0].what, 'interest');
  assert.ok(v.activity.some((a) => a.what === 'in' && a.approvedKey !== null && a.approvedBy !== null && a.amountMinor === $(20_000)));
});

test('"Fees kept inside Splash": each inside-Splash payment records the cheapest bank route’s fee when quoted; the month sums the paid ones; zero hides it', async () => {
  const payer = await company('Selangor Trading Sdn Bhd');
  const payee = await company('Kuching Marine Supply Sdn Bhd');
  await svc.fund(payer.org.id);
  assert.equal((await inv.feesKeptThisMonth(payer.org.id)).sumMinor, 0n, 'nothing yet: the block is hidden');
  const amount = $(1_500);
  const invoice = svc.startPeerTransfer(payer.org.id, {
    payee: { payeeOrgId: payee.org.id, payeeName: 'Kuching Marine Supply Sdn Bhd', payeeHandle: 'kuchingmarine', payeeCountry: 'MY', payeeVaultPda: payee.vault.vaultPda },
    amountUsdMinor: amount.toString(),
    note: 'Spare parts',
    by: 'Aisyah',
  });
  const p = await svc.quote(payer.org.id, invoice.id);
  const expected = svc.bankFeeFor(amount, new Date());
  assert.ok(expected > 0n, 'a bank payout of the same amount has a fee');
  assert.equal(p.feeAvoidedMinor, expected, 'recorded at quote time, from the engine');
  // Quoted but not paid: not counted.
  assert.equal((await inv.feesKeptThisMonth(payer.org.id)).count, 0);
  const view = await svc.paymentView(p.id);
  await svc.selectRoute(p.id, { quoteId: view.cards[0].quoteId });
  const prepared = await svc.prepareApproval(p.id);
  const signatures = [];
  for (const m of prepared.messages) signatures.push({ id: m.id, signature: bs58.encode(await signWithDeviceKey(payer.keys, payer.org.id, new Uint8Array(Buffer.from(m.messageBase64, 'base64')))) });
  const sent = await svc.submitApproval(p.id, { signatures });
  assert.equal(sent.state, 'confirmed');
  const kept = await inv.feesKeptThisMonth(payer.org.id);
  assert.equal(kept.sumMinor, expected);
  assert.equal(kept.count, 1);
  // Next month it is not this month's.
  assert.equal((await inv.feesKeptThisMonth(payer.org.id, new Date(Date.now() + 40 * DAY))).sumMinor, 0n);
  // A bank payout records none.
  assert.equal(svc.bankFeeFor(0n, new Date()), null, 'no amount, no price: nothing is recorded rather than a guess');
});

/* ── The one float (§0.6) ──────────────────────────────────────────────── */

function files(dir, exts) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name).replaceAll('\\', '/');
    if (statSync(full).isDirectory()) return files(full, exts);
    return exts.includes(extname(name)) ? [full] : [];
  });
}

test('the live "Interest today" is display-only: nothing on a money path imports it, and the server sends integers', async () => {
  // Only Treasury's own components read live.ts; no lib, API route, evidence or Zeke code does.
  const LIVE = 'components/solana/treasury/live';
  const resolves = (file, spec) => (spec.startsWith('@/') ? spec.slice(2) : spec.startsWith('.') ? join(file, '..', spec).replaceAll('\\', '/') : spec).replace(/\.ts$/, '') === LIVE;
  const importers = [...files('lib', ['.ts']), ...files('app', ['.ts', '.tsx']), ...files('components', ['.ts', '.tsx'])].filter((f) => [...readFileSync(f, 'utf8').matchAll(/from ['"]([^'"]+)['"]/g)].some((m) => resolves(f, m[1])));
  assert.deepEqual(importers, ['components/solana/treasury/TbillCard.tsx']);
  assert.doesNotMatch(readFileSync('components/solana/treasury/live.ts', 'utf8'), /^import /m, 'live.ts imports nothing');
  // The estimate itself: a number, growing through the day from the booked value, never below it.
  const input = { unitsMicro: (17_793_594_000n).toString(), priceTodayMinor: TBILLS.testPriceMinor.toString(), bps: 375 };
  const midnight = Date.parse('2026-10-14T00:00:00Z');
  const a = liveEstimate(input, midnight);
  const b = liveEstimate(input, midnight + 12 * 3600_000);
  assert.equal(a.interestToday, 0);
  assert.ok(b.interestToday > 0 && b.interestToday < a.perDay);
  assert.equal(typeof b.valueNow, 'number');
  // The server's view carries no fractional number anywhere: bigint or integer only.
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER, ANCHOR);
  await placeOrder(env, { asset: 'usdy', kind: 'subscribe', amountMinor: $(5_000) }, ANCHOR);
  const view = await inv.treasuryView(env.org.id, OWNER, new Date(ANCHOR.getTime() + 3 * DAY));
  const floats = [];
  const walk = (v, path) => {
    if (typeof v === 'number' && !Number.isInteger(v)) floats.push(`${path}=${v}`);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(view, 'view');
  assert.deepEqual(floats, []);
});
