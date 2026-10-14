import assert from 'node:assert/strict';
import test from 'node:test';

import {
  quoteRoutes,
  computeSplashFee,
  isQuoteExpired,
  grossUpForFee,
  centiBpsFee,
  toCentiBps,
  MAX_QUOTE_TTL_SEC,
  SPLASH_MIN_FEE_USDC_MINOR,
  stepCount,
} from '../lib/route-engine/index.ts';
import { tenThousandUsdPhpFixture, FIXTURE_NOW, FIXTURE_PHP_MINOR } from '../lib/route-engine/fixtures.ts';

const USD = (n) => BigInt(Math.round(n * 100)) * 10_000n; // dollars → USDC minor (test helper, whole cents only)
const kindOf = (q) => (q.target.network === 'solana' ? 'direct' : q.flags.includes('fast_transfer') ? 'fast' : 'standard');

test('stepCount: a route straight to the partner is 2 links, one through the lower-cost lane is 3 (display only)', () => {
  const { input } = tenThousandUsdPhpFixture();
  const r = quoteRoutes(input);
  for (const q of r.ranked.cheapest) {
    // Both shapes have two step entries today, so steps.length can't tell them apart.
    assert.equal(q.steps.length, 2);
    assert.equal(stepCount(q), kindOf(q) === 'direct' ? 2 : 3, kindOf(q));
  }
  assert.equal(stepCount({ steps: [{ kind: 'transfer' }, { kind: 'partner' }] }), 2);
  assert.equal(stepCount({ steps: [{ kind: 'bridge' }, { kind: 'partner' }] }), 3);
  assert.equal(stepCount({ steps: [] }), 0);
});

test('US$10,000 PHP payout: three candidates per policy, all pay the supplier in full', () => {
  const { input } = tenThousandUsdPhpFixture();
  const r = quoteRoutes(input);
  assert.equal(r.mode, 'php_receive');
  for (const policy of ['cheapest', 'fastest', 'safest']) {
    assert.equal(r.ranked[policy].length, 3, policy);
    for (const q of r.ranked[policy]) {
      assert.equal(q.policy, policy);
      assert.equal(q.netLocal.currency, 'PHP');
      assert.ok(q.netLocal.amountMinor >= FIXTURE_PHP_MINOR);
      assert.equal(typeof q.source.amountMinor, 'bigint');
      assert.equal(q.source.lane, 'solana');
      assert.equal(q.fx.reference, 'MOCK · not a live rate');
      assert.ok(q.flags.includes('mock_partner'));
      // source = route amount + splash; costs reconcile exactly
      const gross = q.steps.find((s) => s.kind === 'partner') && input.partnerQuotes.find((p) => p.network === q.target.network).grossUsdcMinor;
      assert.equal(q.source.amountMinor, gross + q.costs.routeMinor + q.costs.splashMinor);
      // destination is the partner's one-payment deposit address (I-2)
      assert.equal(q.target.depositAddress, input.deposits[q.target.network]);
    }
  }
  assert.deepEqual(r.excluded, []);
});

test('cheapest: Solana direct wins, Splash 0.10%, all-in 0.30%', () => {
  const { input } = tenThousandUsdPhpFixture();
  const r = quoteRoutes(input);
  const q = r.picks.cheapest;
  assert.equal(kindOf(q), 'direct');
  assert.equal(q.costs.routeMinor, 0n);
  assert.equal(q.costs.splashMinor, USD(10)); // 0.10% of the US$10,000 ticket
  assert.equal(q.costs.partnerMinor, 20_040_081n); // 0.20% of gross, rounded up
  assert.equal(q.costs.allInBps, 30.04);
  assert.deepEqual(q.flags, ['mock_partner']);
  // ranking is by value: the fast transfer debits more for the same PHP, so it ranks last
  assert.equal(kindOf(r.ranked.cheapest[2]), 'fast');
  assert.ok(r.ranked.cheapest[2].source.amountMinor > q.source.amountMinor);
});

test('fastest: minimum ETA among quotes within 0.10% of the best value', () => {
  const { input } = tenThousandUsdPhpFixture();
  const r = quoteRoutes(input);
  const etas = r.ranked.fastest.map((q) => q.etaSec);
  // all three are within 0.10% here; ordered by ETA
  assert.deepEqual([...etas].sort((a, b) => a - b), etas);
  assert.equal(kindOf(r.picks.fastest), 'direct');

  // Make the direct transfer slow: the fast transfer then wins Fastest.
  const slow = tenThousandUsdPhpFixture(FIXTURE_NOW, { assumptions: { solanaTransferEtaSec: 600 } });
  const r2 = quoteRoutes(slow.input);
  assert.equal(kindOf(r2.picks.fastest), 'fast');
  assert.ok(r2.picks.fastest.flags.includes('fast_transfer'));
  assert.ok(r2.picks.fastest.flags.includes('cctp_v2'));
  // The home-lane rule is a cost tie-break and is off for Fastest by default...
  assert.equal(r2.homeLane.fastest.reason, 'policy_not_in_scope');
  // ...when switched on, Solana direct (no route fee, 0.10% Splash) costs no more, so it wins back.
  const r3 = quoteRoutes({ ...slow.input, homeLanePolicies: ['cheapest', 'fastest', 'safest'] });
  assert.equal(r3.homeLane.fastest.applied, true);
  assert.ok(r3.homeLane.fastest.deltaUsdcMinor <= 0n, 'direct is not dearer than the fast route');
  assert.equal(kindOf(r3.picks.fastest), 'direct');
});

test('fastest excludes quotes outside the 0.10% value band even if quicker', () => {
  const { input } = tenThousandUsdPhpFixture(FIXTURE_NOW, { fastTransferFeeBps: '25', assumptions: { solanaTransferEtaSec: 600 } });
  const r = quoteRoutes(input);
  const fast = r.ranked.fastest.find((q) => kindOf(q) === 'fast');
  assert.notEqual(r.picks.fastest.id, fast.id, '0.25% Fast fee puts it outside the band');
  assert.equal(r.ranked.fastest.at(-1).id, fast.id);
});

test('safest: same-chain first, then CCTP V2 Standard, then Fast', () => {
  const { input } = tenThousandUsdPhpFixture();
  const r = quoteRoutes(input);
  assert.deepEqual(r.ranked.safest.map(kindOf), ['direct', 'standard', 'fast']);
  // Splash fee 0.10% on every route (D17): 0.20% partner + 0.10% stays within the 0.33% target
  const q = r.picks.safest;
  assert.ok(q.costs.allInBps <= 33, `all-in ${q.costs.allInBps} bps`);
  assert.ok(!q.flags.includes('above_target'));
  assert.equal(r.fees[q.id].capApplied, false);
});

test('fee: 0.10% on every route; at the 0.33% target nothing is cut, above it Splash cuts its own fee first', () => {
  const t = USD(10_000);
  for (const policy of ['cheapest', 'fastest', 'safest']) {
    const f = computeSplashFee({ policy, ticketUsdcMinor: t, routeMinor: USD(3), partnerMinor: USD(20) });
    assert.equal(f.nominalMinor, USD(10), `${policy}: 0.10% of US$10,000`);
    assert.equal(f.splashMinor, USD(10));
    assert.equal(f.allInMinor, USD(33), '0.03% + 0.20% + 0.10% = 0.33%, at the target');
    assert.equal(f.capApplied, false);
  }
  // route 0.05% + partner 0.20% + 0.10% = 0.35%: Splash cut to 0.08% → 0.33%
  const cut = computeSplashFee({ policy: 'fastest', ticketUsdcMinor: t, routeMinor: USD(5), partnerMinor: USD(20) });
  assert.equal(cut.nominalMinor, USD(10));
  assert.equal(cut.splashMinor, USD(8));
  assert.equal(cut.allInMinor, USD(33));
  assert.equal(cut.capApplied, true);
  assert.equal(cut.aboveTarget, false);
  // Cheapest row: 0.01% + 0.20% + 0.10% = 0.31%, untouched
  const c = computeSplashFee({ policy: 'cheapest', ticketUsdcMinor: t, routeMinor: USD(1), partnerMinor: USD(20) });
  assert.equal(c.splashMinor, USD(10));
  assert.equal(c.capApplied, false);
});

test('fee cap: floor 0.05%, US$2 minimum waived, then above_target', () => {
  // US$2,500 ticket, partner 0.30%: 0.30% + 0.05% floor = 0.35% > 0.33%
  const t = USD(2_500);
  const f = computeSplashFee({ policy: 'cheapest', ticketUsdcMinor: t, routeMinor: 0n, partnerMinor: USD(7.5) });
  assert.equal(f.splashMinor, 1_250_000n); // 0.05% = US$1.25, below the US$2 minimum
  assert.equal(f.minimumWaived, true);
  assert.equal(f.aboveTarget, true);
  // Splash never subsidises partner cost: the fee never goes below the floor or zero
  const huge = computeSplashFee({ policy: 'fastest', ticketUsdcMinor: USD(50_000), routeMinor: 0n, partnerMinor: USD(500) });
  assert.equal(huge.splashMinor, USD(25));
  assert.ok(huge.splashMinor > 0n);
  assert.equal(huge.aboveTarget, true);
});

test('fee cap: below US$2,000 the US$2 minimum applies and no flag is raised', () => {
  const f = computeSplashFee({ policy: 'cheapest', ticketUsdcMinor: USD(500), routeMinor: 0n, partnerMinor: USD(1) });
  assert.equal(f.splashMinor, SPLASH_MIN_FEE_USDC_MINOR);
  assert.equal(f.aboveTarget, false);
  assert.equal(f.capApplied, false);
});

test('above_target flag reaches the RouteQuote', () => {
  const { partner, input } = tenThousandUsdPhpFixture();
  const quotes = input.partnerQuotes.map((q) => ({ ...q, feeBps: 40, feeUsdcMinor: 40_000_000n, grossUsdcMinor: 10_040_000_000n }));
  void partner;
  const r = quoteRoutes({ ...input, partnerQuotes: quotes });
  assert.ok(r.picks.cheapest.flags.includes('above_target'));
  assert.ok(r.picks.cheapest.costs.allInBps > 33);
});

function homeLaneInput(polygonCheaperByMinor, extra = {}) {
  const { input } = tenThousandUsdPhpFixture();
  const quotes = input.partnerQuotes.map((q) => (q.network === 'polygon' ? { ...q, grossUsdcMinor: q.grossUsdcMinor - polygonCheaperByMinor } : q));
  return { ...input, partnerQuotes: quotes, fastTransferFeeBps: undefined, ...extra };
}

test('home lane: Solana direct wins within max(US$1, 0.02%) and the difference is reported', () => {
  const r = quoteRoutes(homeLaneInput(USD(1.5)));
  const d = r.homeLane.cheapest;
  assert.equal(d.applied, true);
  assert.equal(d.reason, 'within_threshold');
  assert.equal(kindOf(r.picks.cheapest), 'direct');
  assert.ok(r.picks.cheapest.flags.includes('home_lane'));
  assert.equal(d.thresholdUsdcMinor, 2_005_707n); // 0.02% of the winner's US$10,028.54 debit (> US$1)
  assert.ok(d.deltaUsdcMinor > USD(1.4) && d.deltaUsdcMinor <= USD(1.51), `delta ${d.deltaUsdcMinor}`);
  assert.notEqual(d.bestQuoteId, d.homeQuoteId);
});

test('home lane: outside the threshold the cheaper bridge keeps the win', () => {
  const r = quoteRoutes(homeLaneInput(USD(5)));
  assert.equal(r.homeLane.cheapest.applied, false);
  assert.equal(r.homeLane.cheapest.reason, 'outside_threshold');
  assert.equal(kindOf(r.picks.cheapest), 'standard');
  assert.ok(!r.picks.cheapest.flags.includes('home_lane'));
});

test('home lane never applies to "strictly cheapest"', () => {
  const r = quoteRoutes(homeLaneInput(USD(1.5), { strictlyCheapest: true }));
  assert.equal(r.homeLane.cheapest.applied, false);
  assert.equal(r.homeLane.cheapest.reason, 'strictly_cheapest');
  assert.equal(kindOf(r.picks.cheapest), 'standard');
  // still reported, so the UI can show the difference
  assert.ok(r.homeLane.cheapest.deltaUsdcMinor > 0n);
  // other policies are unaffected by the cheapest-only switch
  assert.equal(r.homeLane.safest.reason, 'winner_is_home_lane');
});

test('home lane with a non-Solana home chain never fires on this lane', () => {
  const r = quoteRoutes(homeLaneInput(USD(1.5), { homeChain: 'sui' }));
  assert.equal(r.homeLane.cheapest.reason, 'no_home_lane_quote');
  assert.equal(kindOf(r.picks.cheapest), 'standard');
});

test('home chain defaults to solana and reads no env', () => {
  const prev = process.env.ENGINE_HOME_CHAIN;
  process.env.ENGINE_HOME_CHAIN = 'sui';
  try {
    const input = homeLaneInput(USD(1.5));
    delete input.homeChain;
    assert.equal(quoteRoutes(input).homeChain, 'solana');
    assert.equal(quoteRoutes({ ...input, homeChain: 'sui' }).homeChain, 'sui');
  } finally {
    if (prev === undefined) delete process.env.ENGINE_HOME_CHAIN;
    else process.env.ENGINE_HOME_CHAIN = prev;
  }
});

test('expiry: ≤ 60 s, clamped below a longer partner TTL, and expired partner quotes are dropped', () => {
  const { input } = tenThousandUsdPhpFixture();
  const longTtl = input.partnerQuotes.map((q) => ({ ...q, expiresAt: new Date(FIXTURE_NOW.getTime() + 300_000).toISOString() }));
  const r = quoteRoutes({ ...input, partnerQuotes: longTtl });
  for (const q of r.ranked.cheapest) {
    const ttl = (Date.parse(q.expiresAt) - FIXTURE_NOW.getTime()) / 1000;
    assert.ok(ttl > 0 && ttl <= MAX_QUOTE_TTL_SEC, `ttl ${ttl}`);
    assert.equal(isQuoteExpired(q, FIXTURE_NOW), false);
    assert.equal(isQuoteExpired(q, new Date(FIXTURE_NOW.getTime() + 59_999)), false);
    assert.equal(isQuoteExpired(q, new Date(FIXTURE_NOW.getTime() + 60_000)), true);
  }
  const later = quoteRoutes({ ...input, now: new Date(FIXTURE_NOW.getTime() + 61_000) });
  assert.equal(later.picks.cheapest, null);
  assert.ok(later.excluded.every((e) => e.reason === 'partner_quote_expired'));
});

test('insufficient balance excludes a quote per policy; nothing affordable → no pick', () => {
  const { input } = tenThousandUsdPhpFixture();
  // Direct debits 10,030.04 on every policy (0.10% everywhere); the CCTP routes cost more.
  const r = quoteRoutes({ ...input, senderBalanceUsdcMinor: 10_030_040_081n });
  assert.equal(kindOf(r.picks.cheapest), 'direct');
  assert.equal(kindOf(r.picks.safest), 'direct');
  assert.ok(r.excluded.some((e) => e.reason === 'insufficient_balance' && e.kind !== 'solana_direct'), 'the dearer CCTP routes are excluded');
  const broke = quoteRoutes({ ...input, senderBalanceUsdcMinor: 10_030_040_080n });
  for (const policy of ['cheapest', 'fastest', 'safest']) assert.equal(broke.picks[policy], null, `${policy}: one micro-dollar short`);
  assert.ok(broke.excluded.some((e) => e.reason === 'insufficient_balance' && e.policy === 'safest'));
});

test('no Fast candidate without a fee; registry filters networks; bad deposit addresses are refused', () => {
  const { input } = tenThousandUsdPhpFixture();
  const noFast = quoteRoutes({ ...input, fastTransferFeeBps: undefined });
  assert.equal(noFast.ranked.cheapest.length, 2);
  assert.ok(noFast.excluded.some((e) => e.kind === 'cctp_v2_fast' && e.reason === 'fast_transfer_fee_unknown'));

  const solanaOnly = { ...input.partner, acceptedTargets: [{ network: 'solana', token: 'USDC' }] };
  const r = quoteRoutes({ ...input, partner: solanaOnly });
  assert.deepEqual(r.ranked.cheapest.map(kindOf), ['direct']);
  assert.ok(r.excluded.some((e) => e.reason === 'network_not_accepted'));

  const bad = quoteRoutes({ ...input, deposits: { ...input.deposits, polygon: 'not-an-address' } });
  assert.ok(bad.excluded.some((e) => e.reason === 'bad_deposit_address'));
});

test('USDC-send mode: amount is what reaches the partner; PHP follows from the quote', () => {
  const { partner, input } = tenThousandUsdPhpFixture();
  const amountUsdcMinor = USD(5_000);
  const partnerQuotes = ['solana', 'polygon'].map((network) => partner.quote({ amountUsdcMinor }, { network, now: FIXTURE_NOW }));
  const r = quoteRoutes({ ...input, amount: { amountUsdcMinor }, partnerQuotes });
  assert.equal(r.mode, 'usdc_send');
  const q = r.picks.cheapest;
  assert.equal(q.source.amountMinor, amountUsdcMinor + q.costs.routeMinor + q.costs.splashMinor);
  assert.equal(q.netLocal.amountMinor, partnerQuotes[0].netPhpMinor);
  // mismatched partner quote is refused
  const wrong = quoteRoutes({ ...input, amount: { amountUsdcMinor: USD(4_000) }, partnerQuotes });
  assert.equal(wrong.picks.cheapest, null);
});

test('CCTP Fast fee in fractional bps, grossed up exactly', () => {
  const c = toCentiBps('1.3');
  assert.equal(c, 130n);
  const net = 10_020_040_081n;
  const burn = grossUpForFee(net, c);
  assert.ok(burn - centiBpsFee(burn, c) >= net);
  assert.ok(burn - 1n - centiBpsFee(burn - 1n, c) < net, 'minimal');
  assert.throws(() => toCentiBps('0.001'));
});

test('deterministic: same input → same quotes and ids', () => {
  const a = quoteRoutes(tenThousandUsdPhpFixture().input);
  const b = quoteRoutes(tenThousandUsdPhpFixture().input);
  assert.deepEqual(a.ranked, b.ranked);
});
