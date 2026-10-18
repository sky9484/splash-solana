// Prompt 10 Phase 5 (§7): Treasury's investments in test mode, through the services. Every rate and
// return carries its date and source; sweep drafts at most once a day and never approves; T-bills held
// from Ondo can't be redeemed until the hold ends; Ondo's redemption goes by wire and never credits the
// Payments account; the owner confirms eligibility once; nothing settles without the device's approval
// of the exact order text; every settled order leaves a kind-6 receipt. Integers only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';

import bs58 from 'bs58';

import { createDeviceKey, createMemoryDeviceKeyStore, signWithDeviceKey } from '../lib/solana/device-key.ts';
import { deriveRecoveryKey, generateRecoveryWords, signPossessionChallenge } from '../lib/solana/recovery-kit.ts';
import { buildTreasuryOrderBundle } from '../lib/solana-evidence/bundle.ts';
import * as inv from '../lib/solana-app/investments.ts';
import { resetRuntime, runtime } from '../lib/solana-app/runtime.ts';
import * as svc from '../lib/solana-app/service.ts';
import { resetStore } from '../lib/solana-app/store.ts';
import * as treasury from '../lib/solana-app/treasury-service.ts';
import { ageDays, allSourced, isFresh, REFERENCE_MAX_AGE_DAYS, STOCKS, TBILLS } from '../lib/treasury/reference.ts';
import { sweepDraft } from '../lib/treasury/sweep.ts';

beforeEach(() => {
  delete process.env.SPLASH_SOLANA_MODE;
  process.env.SOLANA_PAYMENT_STORE = 'memory';
  resetStore();
  resetRuntime();
});

const $ = (dollars, cents = 0) => BigInt(dollars) * 1_000_000n + BigInt(cents) * 10_000n;
const DAY = 86_400_000;
const OWNER = { isOwner: true, name: 'Aisyah' };

async function company() {
  const org = svc.createOrg({ companyName: 'Selangor Trading Sdn Bhd', personName: 'Aisyah' });
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
  return { org, keys, deviceKey: device.publicKey };
}

/** Prepare an order and approve its exact text with this device. */
async function placeOrder(env, req, now = new Date()) {
  const { order, message } = await inv.prepareOrder(env.org.id, req, 'Aisyah', now);
  const signature = bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new TextEncoder().encode(message)));
  return inv.approveOrder(env.org.id, order.id, { signature, who: 'Aisyah', deviceKey: env.deviceKey }, now);
}

async function balances(env) {
  const chain = runtime().chain;
  return { payments: await chain.getUsdcBalance(env.org.vault.vaultPda), reserve: await chain.getUsdcBalance(svc.treasuryVaultPda(env.org.vault.multisigPda)) };
}

/* ── Reference data ───────────────────────────────────────────────────── */

test('a test price prints to four decimals, rounded half-up, so the units beside it agree with it (prompt 12 §1.3)', () => {
  // 18 Oct 2026's simulated T-bill price: cut off at four decimals it read US$1.1245, and 80,000 / 1.1245
  // missed the 71,138.55 units shown by more than rounding allows (the walkthrough's Treasury step).
  assert.equal(inv.priceText(1_124_566n), 'US$1.1246');
  assert.equal(inv.priceText(1_124_550n), 'US$1.1246', 'half goes up');
  assert.equal(inv.priceText(1_124_549n), 'US$1.1245');
  assert.equal(inv.priceText(1_124_000n), 'US$1.1240');
  assert.equal(inv.priceText(1_999_950n), 'US$2.0000', 'a carry reaches the whole dollars');
  assert.equal(inv.priceText(12_345_678_900n), 'US$12,345.6789');
});

test('every rate and past return carries the day it was true and an https source, and none is older than 35 days', () => {
  const now = new Date();
  const figures = allSourced();
  assert.equal(figures.length, 1 + STOCKS.length * 2);
  for (const { label, figure } of figures) {
    assert.match(figure.asOf, /^\d{4}-\d{2}-\d{2}$/, `${label}: a date`);
    assert.match(figure.sourceUrl, /^https:\/\/[^\s]+$/, `${label}: a source`);
    assert.ok(ageDays(figure, now) >= 0, `${label}: not dated in the future`);
    assert.ok(isFresh(figure, now), `${label} is ${ageDays(figure, now)} days old: refresh reference.ts (§7.1)`);
  }
  // A figure past 35 days shows "Rate out of date" instead of the number.
  const old = { asOf: '2026-01-01' };
  assert.equal(isFresh(old, new Date(Date.parse('2026-01-01T00:00:00Z') + REFERENCE_MAX_AGE_DAYS * DAY)), true);
  assert.equal(isFresh(old, new Date(Date.parse('2026-01-01T00:00:00Z') + (REFERENCE_MAX_AGE_DAYS + 1) * DAY)), false);
  // The T-bills address is Ondo's own; the hold is marked unconfirmed.
  assert.equal(TBILLS.mintSolana.sourceUrl, 'https://docs.ondo.finance/addresses');
  assert.equal(TBILLS.holdDays.confirmed, false);
});

test('the treasury view prints a stale rate as out of date, not as a number', async () => {
  const env = await company();
  const fresh = await inv.treasuryView(env.org.id, OWNER);
  assert.equal(fresh.tbills.rate.fresh, true);
  const late = await inv.treasuryView(env.org.id, OWNER, new Date(Date.parse(`${TBILLS.rate.asOf}T00:00:00Z`) + 40 * DAY));
  assert.equal(late.tbills.rate.fresh, false);
  assert.ok(late.stocks.rows.every((r) => r.return12m.fresh === false));
});

/* ── Sweep ─────────────────────────────────────────────────────────────── */

const frame = { paymentsMinor: $(25_000), reserveMinor: $(31_460), investmentsMinor: $(40_000), stocksMinor: $(10_000), approvedUnsentMinor: 0n, billsDueMinor: $(28_600), waitingMinor: $(5_012, 50) };
const ON = { on: true, cushionMinor: $(5_000) };

test('sweep: the frame’s figures draft a subscription of US$14,987.50; hold drafts nothing; nothing under US$500', () => {
  assert.deepEqual(sweepDraft({ position: frame, rule: ON, redeemableMinor: $(26_000) }), { kind: 'subscribe', amountMinor: $(14_987, 50), reason: 'cash above your reserve and cushion' });
  assert.equal(sweepDraft({ position: frame, rule: { ...ON, on: false }, redeemableMinor: $(26_000) }), null);
  // US$499.99 above the cushion: no draft.
  assert.equal(sweepDraft({ position: { ...frame, paymentsMinor: frame.waitingMinor + $(5_000) + $(499, 99) }, rule: ON, redeemableMinor: 0n }), null);
  assert.equal(sweepDraft({ position: { ...frame, paymentsMinor: frame.waitingMinor + $(5_500) }, rule: ON, redeemableMinor: 0n }).amountMinor, $(500));
});

test('sweep, back: short of the floor redeems only units out of their hold, and never also subscribes', () => {
  const low = { ...frame, paymentsMinor: $(10_000), reserveMinor: $(15_000) };
  assert.deepEqual(sweepDraft({ position: low, rule: ON, redeemableMinor: $(26_000) }), { kind: 'redeem', amountMinor: $(6_460), reason: 'bills due need the money back' });
  // Everything still in its hold: nothing can come back, so nothing is drafted (and no subscription either).
  assert.equal(sweepDraft({ position: low, rule: ON, redeemableMinor: 0n }), null);
  assert.equal(sweepDraft({ position: low, rule: ON, redeemableMinor: $(300) }), null);
});

test('the sweep job drafts at most once a day, replaces an unapproved draft the next day, and never approves or moves money', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  await treasury.fundTreasury(env.org.id);
  const before = await balances(env);
  const day1 = new Date('2026-10-14T01:00:00Z');
  assert.equal(await inv.draftSweep(env.org.id, day1), null, 'off for every new company');
  assert.throws(() => inv.setSweepRule(env.org.id, { on: true }, { isOwner: false, name: 'Ben' }, day1), (e) => e.code === 'not_authorized');
  inv.setSweepRule(env.org.id, { on: true }, OWNER, day1);
  const first = await inv.draftSweep(env.org.id, day1);
  assert.equal(first.kind, 'subscribe');
  // No payables: the whole Reserve is surplus, plus the Payments account above the cushion.
  assert.equal(first.amountMinor, before.reserve + before.payments - $(5_000));
  assert.equal((await inv.draftSweep(env.org.id, new Date('2026-10-14T23:00:00Z'))).id, first.id, 'the same draft all day');
  const second = await inv.draftSweep(env.org.id, new Date('2026-10-15T01:00:00Z'));
  assert.notEqual(second.id, first.id);
  const org = svc.getOrg(env.org.id);
  assert.equal(org.sweepDrafts.find((d) => d.id === first.id).state, 'replaced');
  assert.equal(org.sweepDrafts.filter((d) => d.state === 'drafted').length, 1);
  // Drafting moved nothing and placed no order.
  assert.deepEqual(await balances(env), before);
  assert.equal(org.investments?.orders.length ?? 0, 0);
  // The owner's changes are recorded with who and when; turning sweep off withdraws the waiting draft.
  inv.setSweepRule(env.org.id, { on: false }, OWNER, new Date('2026-10-15T02:00:00Z'));
  assert.equal(org.sweepDrafts.find((d) => d.id === second.id).state, 'withdrawn');
  assert.equal(org.treasuryRules.audit.length, 2);
  assert.match(org.treasuryRules.audit[0].change, /sweep off → on/);
  // The cron route only drafts, behind the cron secret.
  const cron = readFileSync(new URL('../app/api/cron/treasury-sweep/route.ts', import.meta.url), 'utf8');
  assert.match(cron, /cronAuthorized\(request\)/);
  assert.doesNotMatch(cron, /approveOrder|prepareOrder|settleTestOrder/);
});

test('with sweep off, Zeke’s idle figure is the page’s Available to invest, not the Payments account less what waits', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  const v = await inv.treasuryView(env.org.id, OWNER);
  assert.equal(v.sweep.on, false);
  const usd = (minor) => `US$${(BigInt(minor) / 1_000_000n).toLocaleString('en-US')}.${((BigInt(minor) % 1_000_000n) / 10_000n).toString().padStart(2, '0')}`;
  assert.equal(v.zeke, `${usd(v.available.totalMinor)} is available to invest: what’s left after what’s waiting and your reserve’s floor. Sweep is off, so I won’t draft a move, and I never pick an investment for you.`);
});

test('a sweep draft opens as its own order and is marked approved once a person approves it', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER);
  inv.setSweepRule(env.org.id, { on: true }, OWNER);
  const draft = await inv.draftSweep(env.org.id);
  assert.equal(draft.amountMinor, $(20_000), 'US$25,000 less the US$5,000 cushion');
  const order = await placeOrder(env, inv.orderRequestFrom({ sweepDraftId: draft.id }));
  assert.equal(order.amountMinor, $(20_000));
  assert.equal(order.sweepDraftId, draft.id);
  assert.equal(svc.getOrg(env.org.id).sweepDrafts.find((d) => d.id === draft.id).state, 'approved');
  const r = await svc.receiptView(order.receiptId);
  assert.equal(r.bundle.sweep.draftId, draft.id);
  assert.equal(r.bundle.sweep.cushionMinor, $(5_000));
  await assert.rejects(() => inv.prepareOrder(env.org.id, { asset: 'usdy', kind: 'subscribe', amountMinor: 0n, sweepDraftId: draft.id }, 'Aisyah'), (e) => e.code === 'wrong_state');
  // Zeke says today's sweep is decided, not that nothing needed drafting.
  const v = await inv.treasuryView(env.org.id, OWNER);
  assert.equal(v.zeke, 'Today’s sweep into T-bills, US$20,000.00, is approved. I’ll look again tomorrow, and I never pick an investment for you.');
});

/* ── Orders ───────────────────────────────────────────────────────────── */

test('the eligibility gate: no subscription or buy until the owner confirms once; anyone else is told the owner does it', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  const q = await inv.quoteOrder(env.org.id, { asset: 'usdy', kind: 'subscribe', amountMinor: $(1_000) });
  assert.equal(q.ok, false);
  assert.match(q.problem, /owner confirms once/);
  await assert.rejects(() => inv.prepareOrder(env.org.id, { asset: 'spy', kind: 'buy', amountMinor: $(1_000) }, 'Aisyah'), (e) => e.code === 'not_authorized');
  assert.throws(() => inv.confirmEligibility(env.org.id, { isOwner: false, name: 'Ben' }), (e) => e.code === 'not_authorized');
  const confirmed = inv.confirmEligibility(env.org.id, OWNER);
  assert.equal(confirmed.by, 'Aisyah');
  assert.equal((await inv.quoteOrder(env.org.id, { asset: 'usdy', kind: 'subscribe', amountMinor: $(1_000) })).ok, true);
  assert.equal((await inv.treasuryView(env.org.id, { isOwner: false })).eligibility.confirmed, true);
});

test('subscribe on the market, then redeem on the market: no hold, the money comes back into the Payments account, receipts of kind 6', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER);
  const start = await balances(env);
  // On the day the rate is dated the booked price is the test price itself (prompt 11 §4.2, history.ts).
  const q = await inv.quoteOrder(env.org.id, { asset: 'usdy', kind: 'subscribe', amountMinor: $(10_000) }, new Date(`${TBILLS.rate.asOf}T12:00:00Z`));
  assert.equal(q.request.path, 'market', 'the planner picks the market within the 0.30% limit');
  assert.equal(q.words.units, '8,896.79 units at US$1.1240 (test price)');
  assert.match(q.words.how, /^On the market · no hold · price moved by 0\.04% \(limit 0\.30%\)$/);
  const sub = await placeOrder(env, { asset: 'usdy', kind: 'subscribe', amountMinor: $(10_000) });
  assert.equal(sub.state, 'settled');
  assert.equal(sub.holdUntil, null);
  assert.equal((await balances(env)).payments, start.payments - $(10_000));
  const view = await inv.treasuryView(env.org.id, OWNER);
  assert.equal(view.tbills.holding.heldMinor, 0n);
  assert.equal(view.accounts.investmentsMinor, view.tbills.holding.valueMinor);
  // Redeem it on the market: into the Payments account.
  const red = await placeOrder(env, { asset: 'usdy', kind: 'redeem', amountMinor: $(5_000) });
  assert.equal(red.landsIn, 'payments');
  assert.equal((await balances(env)).payments, start.payments - $(10_000) + $(5_000));
  // Both receipts are kind 6, verify their shape, and name the device approval.
  for (const id of [sub.receiptId, red.receiptId]) {
    const r = await svc.receiptView(id);
    assert.equal(r.bundle.kind, 6);
    assert.equal(r.summary.kind, 'treasury');
    assert.equal(r.bundle.approval.keyPublic, env.deviceKey);
    assert.match(r.bundle.approval.messageSha256, /^[0-9a-f]{64}$/);
    const pack = await svc.evidencePack(id);
    assert.equal(pack.bundle.kindName, 'treasury');
  }
  // History's gold rows and Balance's Treasury rows.
  const history = (await svc.orgSummary(env.org.id)).treasuryOrders;
  assert.deepEqual(history.map((o) => o.kind), ['redeem', 'subscribe']);
});

test('straight from Ondo: units are held 40 days; held units can’t be redeemed or counted in sweep, back; the release date shows (fake clock)', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER);
  const t0 = new Date('2026-10-14T03:00:00Z');
  const sub = await placeOrder(env, { asset: 'usdy', kind: 'subscribe', amountMinor: $(4_000), path: 'ondo' }, t0);
  assert.equal(sub.holdUntil, new Date(t0.getTime() + 40 * DAY).toISOString());
  const held = await inv.treasuryView(env.org.id, OWNER, t0);
  assert.equal(held.tbills.holding.redeemableMinor, 0n);
  assert.equal(held.tbills.holding.heldUntilLabel, '23 Nov');
  assert.equal(held.positions[0].heldMinor, held.positions[0].valueMinor);
  const q = await inv.quoteOrder(env.org.id, { asset: 'usdy', kind: 'redeem', amountMinor: $(1_000) }, t0);
  assert.equal(q.ok, false);
  assert.match(q.problem, /in its hold until 23 Nov/);
  await assert.rejects(() => placeOrder(env, { asset: 'usdy', kind: 'redeem', amountMinor: $(1_000) }, t0), (e) => e.code === 'bad_request');
  // Sweep, back sees nothing redeemable while the units are held.
  const { holdings } = await inv.treasuryPosition(svc.getOrg(env.org.id), t0);
  assert.equal(holdings.per[0].redeemableMinor, 0n);
  // A day after the hold ends they can go.
  const t41 = new Date(t0.getTime() + 41 * DAY);
  const after = await inv.treasuryView(env.org.id, OWNER, t41);
  assert.equal(after.tbills.holding.heldMinor, 0n);
  assert.equal((await placeOrder(env, { asset: 'usdy', kind: 'redeem', amountMinor: $(1_000) }, t41)).state, 'settled');
});

test('redeeming with Ondo sends US dollars by wire to the company’s bank: the Payments account is never credited', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER);
  await placeOrder(env, { asset: 'usdy', kind: 'subscribe', amountMinor: $(6_000) });
  const before = await balances(env);
  const q = await inv.quoteOrder(env.org.id, { asset: 'usdy', kind: 'redeem', amountMinor: $(2_000), path: 'ondo' });
  assert.equal(q.quote.landsIn, 'bank_wire');
  assert.match(q.note, /bank wire to your company’s bank account, outside Splash/);
  assert.match(q.words.lands, /by wire, outside Splash/);
  // The planner never picks the wire for a redemption by itself.
  assert.equal((await inv.quoteOrder(env.org.id, { asset: 'usdy', kind: 'redeem', amountMinor: $(2_000) })).request.path, 'market');
  const red = await placeOrder(env, { asset: 'usdy', kind: 'redeem', amountMinor: $(2_000), path: 'ondo' });
  assert.equal(red.landsIn, 'bank_wire');
  assert.deepEqual(await balances(env), before, 'nothing landed in the Payments account or the Reserve');
  const r = await svc.receiptView(red.receiptId);
  assert.ok(r.bundle.wire);
  assert.equal(r.bundle.chain.signatures.length, 0);
  // A bundle that claims a wire but lands in Payments doesn't build.
  assert.throws(() => buildTreasuryOrderBundle({ ...r.bundle, order: { ...r.bundle.order, landsIn: 'payments' } }), /only a redemption with Ondo goes by wire/);
});

test('subscribing draws the Reserve’s surplus first, then the Payments account; never below the floor or into what is waiting', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  await treasury.fundTreasury(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER);
  const start = await balances(env);
  const sub = await placeOrder(env, { asset: 'usdy', kind: 'subscribe', amountMinor: start.reserve + $(1_000) });
  assert.deepEqual(sub.from, { reserveMinor: start.reserve, paymentsMinor: $(1_000) });
  const now = await balances(env);
  assert.equal(now.reserve, 0n);
  assert.equal(now.payments, start.payments - $(1_000));
  // More than is available: refused, with why.
  const q = await inv.quoteOrder(env.org.id, { asset: 'usdy', kind: 'subscribe', amountMinor: now.payments + $(1) });
  assert.equal(q.ok, false);
  assert.match(q.problem, /Available to invest/);
});

test('buy and sell a stock end to end, within the 20% stock limit and the 0.30% price-moved limit', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  await treasury.fundTreasury(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER);
  // Treasury is US$100,000 (the Reserve): 20% after a buy allows US$25,000 from the Payments account side,
  // but the S&P 500's thin test market stops anything over US$7,140 (0.30% of its depth).
  const q = await inv.quoteOrder(env.org.id, { asset: 'spy', kind: 'buy', amountMinor: $(5_000) });
  assert.equal(q.ok, true);
  assert.equal(q.words.howLabel, 'Price moved by');
  assert.equal(q.words.how, '0.22% · limit 0.30%');
  assert.match(q.stockCapLine, /Your 20% stock limit allows up to US\$\d/);
  const big = await inv.quoteOrder(env.org.id, { asset: 'spy', kind: 'buy', amountMinor: $(8_000) });
  assert.equal(big.ok, false);
  assert.match(big.problem, /0\.30%/);
  const buy = await placeOrder(env, { asset: 'spy', kind: 'buy', amountMinor: $(5_000) });
  assert.equal(buy.landsIn, 'investments');
  const view = await inv.treasuryView(env.org.id, OWNER);
  assert.equal(view.stocks.rows.find((r) => r.id === 'spy').holdingMinor, view.positions.find((p) => p.asset === 'spy').valueMinor);
  assert.ok(view.stocks.sharePct > 0n);
  const before = await balances(env);
  const sell = await placeOrder(env, { asset: 'spy', kind: 'sell', amountMinor: $(2_000) });
  assert.equal(sell.landsIn, 'payments');
  assert.equal((await balances(env)).payments, before.payments + $(2_000));
  // T-bills are subscribed and redeemed; stocks are bought and sold.
  await assert.rejects(() => inv.quoteOrder(env.org.id, { asset: 'usdy', kind: 'buy', amountMinor: $(1_000) }), (e) => e.code === 'bad_request');
  await assert.rejects(() => inv.quoteOrder(env.org.id, { asset: 'spy', kind: 'subscribe', amountMinor: $(1_000) }), (e) => e.code === 'bad_request');
});

test('the device’s approval is required: a wrong approval, another key, or an order past its 60 seconds settles nothing', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER);
  const start = await balances(env);
  const t0 = new Date();
  const { order, message } = await inv.prepareOrder(env.org.id, { asset: 'usdy', kind: 'subscribe', amountMinor: $(1_000) }, 'Aisyah', t0);
  assert.ok(message.startsWith('splash:challenge:v1:treasury-order\n'), 'domain-separated: never a transaction');
  const good = bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new TextEncoder().encode(message)));
  const other = bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new TextEncoder().encode(message.replace('amount:', 'amount:9'))));
  await assert.rejects(() => inv.approveOrder(env.org.id, order.id, { signature: other, who: 'Aisyah', deviceKey: env.deviceKey }, t0), (e) => e.code === 'signature_invalid');
  await assert.rejects(() => inv.approveOrder(env.org.id, order.id, { signature: good, who: 'Aisyah', deviceKey: bs58.encode(new Uint8Array(32).fill(7)) }, t0), (e) => e.code === 'not_an_approver');
  await assert.rejects(() => inv.approveOrder(env.org.id, order.id, { signature: good, who: 'Aisyah', deviceKey: env.deviceKey }, new Date(t0.getTime() + 61_000)), (e) => e.code === 'quote_expired');
  assert.deepEqual(await balances(env), start);
  assert.equal(svc.getOrg(env.org.id).investments.lots.length, 0);
});

/* ── Overview, Balance, the words ─────────────────────────────────────── */

test('Overview and Balance read the same investments, and the waiting sweep draft is one Needs-you row', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER);
  const { overviewFor } = await import('../lib/solana-app/overview.ts');
  const { balanceFor } = await import('../lib/solana-app/balance.ts');
  let o = await overviewFor({ orgId: env.org.id, companyCheck: 'ACTIVE', setupOpen: [] });
  assert.equal(o.money.investmentsSetUp, false);
  await placeOrder(env, { asset: 'usdy', kind: 'subscribe', amountMinor: $(3_000) });
  o = await overviewFor({ orgId: env.org.id, companyCheck: 'ACTIVE', setupOpen: [] });
  const t = await inv.treasuryView(env.org.id, OWNER);
  const b = await balanceFor(env.org.id);
  assert.equal(o.money.investmentsSetUp, true);
  assert.equal(o.money.investmentsMinor, t.accounts.investmentsMinor);
  assert.equal(b.investmentsMinor, t.accounts.investmentsMinor);
  assert.equal(o.money.totalMinor, t.accounts.totalMinor);
  const row = b.rows.find((r) => r.tag.label === 'Treasury');
  assert.equal(row.what, 'Subscribed to T-bills');
  assert.equal(row.amountMinor, -$(3_000));
  inv.setSweepRule(env.org.id, { on: true }, OWNER);
  await inv.draftSweep(env.org.id);
  o = await overviewFor({ orgId: env.org.id, companyCheck: 'ACTIVE', setupOpen: [] });
  const sweep = [...o.needs.rows, ...o.needs.more].filter((r) => r.kind === 'sweep');
  assert.equal(sweep.length, 1);
  assert.match(sweep[0].title, /^Sweep drafted · US\$[\d,.]+ into T-bills$/);
  assert.match(sweep[0].action.href, /^\/dashboard\/treasury\?sweep=swp_[0-9a-f]{16}$/);
});

const T_BILLS_BANNED = /\b(?:buy|buying|sell|selling|withdraw(?:al)?s?|yields?|APR|APY|earn(?:s|ed|ing)?)\b/i;
/** "Deposit" only as "Not a bank deposit" and "bank deposits" (what backs the note). */
const DEPOSIT = /\bdeposits?\b/gi;

test('claims: the T-bills card and its sheets never say Buy, Sell, Deposit, Withdraw, yield, APR, APY or earn; "Not a bank deposit" stays', async () => {
  // Prompt 11 §4.2: the T-bill pool card is its own file, with its chart.
  const card = ['TbillCard.tsx', 'InterestChart.tsx'].map((f) => readFileSync(new URL(`../components/solana/treasury/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.ok(card.length > 1000, 'found the T-bills card');
  const text = card.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(text, T_BILLS_BANNED);
  assert.match(text, /Not a bank deposit; its value can fall\./);
  for (const m of text.matchAll(DEPOSIT)) assert.match(text.slice(Math.max(0, m.index - 5), m.index + m[0].length), /bank deposits?$/i, 'deposit only as a bank deposit');
  // The sheets' words, for every T-bills order and path, from the server.
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER);
  await placeOrder(env, { asset: 'usdy', kind: 'subscribe', amountMinor: $(2_000) });
  for (const kind of ['subscribe', 'redeem']) {
    for (const path of ['market', 'ondo']) {
      const q = await inv.quoteOrder(env.org.id, { asset: 'usdy', kind, path, amountMinor: $(1_000) });
      const words = [q.name, q.note, q.limit.why, q.problem ?? '', ...Object.values(q.words)].join(' · ');
      assert.doesNotMatch(words, T_BILLS_BANNED, `${kind}/${path}: ${words}`);
      assert.doesNotMatch(words, DEPOSIT, `${kind}/${path}`);
    }
  }
  const sheet = readFileSync(new URL('../components/solana/treasury/OrderSheet.tsx', import.meta.url), 'utf8');
  assert.match(sheet, /subscribe: \(\) => 'Subscribe to US Treasury bills'/);
  assert.match(sheet, /redeem: \(\) => 'Redeem US Treasury bills'/);
  assert.match(sheet, /tbill: 'Not a bank deposit; its value can fall\.'/);
  // Dividends are never called a yield, anywhere on the page (prompt 11: the page is several files now).
  const page = ['Treasury.tsx', 'TbillCard.tsx', 'InterestChart.tsx', 'Stocks.tsx', 'HoldSweep.tsx', 'RiskRules.tsx'].map((f) => readFileSync(new URL(`../components/solana/treasury/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(page.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /\byields?\b|\bAPY\b|\bAPR\b|\bearn/i);
});

test('the ribbon is on every investment surface, and Zeke never names a rate or a return', async () => {
  const page = readFileSync(new URL('../components/solana/treasury/Treasury.tsx', import.meta.url), 'utf8');
  const sheet = readFileSync(new URL('../components/solana/treasury/OrderSheet.tsx', import.meta.url), 'utf8');
  assert.match(page, /Investments aren’t live until legal sign-off in Malaysia\. Buttons work on test money\./);
  assert.match(sheet, /<TestModeBadge \/>/, 'the order sheet');
  assert.match(sheet, /<TestModeBadge inline \/>/, 'the approval moment');
  const env = await company();
  await svc.fund(env.org.id);
  for (const on of [false, true]) {
    inv.setSweepRule(env.org.id, { on }, OWNER);
    const v = await inv.treasuryView(env.org.id, OWNER);
    assert.doesNotMatch(v.zeke, /%|a year|return|rate/i, v.zeke);
    assert.match(v.zeke, /never pick|Nothing moves until a person approves/);
  }
});

test('two approvals of one order at the same moment settle it once: one debit, one lot (review finding, 16 Oct)', async () => {
  const env = await company();
  await svc.fund(env.org.id);
  inv.confirmEligibility(env.org.id, OWNER);
  const start = await balances(env);
  const { order, message } = await inv.prepareOrder(env.org.id, { asset: 'usdy', kind: 'subscribe', amountMinor: $(2_000) }, 'Aisyah');
  const signature = bs58.encode(await signWithDeviceKey(env.keys, env.org.id, new TextEncoder().encode(message)));
  const approve = () => inv.approveOrder(env.org.id, order.id, { signature, who: 'Aisyah', deviceKey: env.deviceKey });
  const [a, b] = await Promise.all([approve(), approve()]);
  assert.equal(a.state, 'settled');
  assert.equal(b.state, 'settled');
  assert.equal(a.receiptId, b.receiptId, 'one receipt');
  const after = await balances(env);
  assert.equal(start.payments + start.reserve - (after.payments + after.reserve), $(2_000), 'the money moved once');
  assert.equal(env.org.investments.lots.filter((l) => l.orderId === order.id).length, 1, 'one lot');
});
