// Prompt 11 §4.2 and §4.4: the T-bill pool's booked price, the interest each day booked, and the
// quarterly "bring this quarter's interest back" draft. Integers only; a fake clock for the quarter.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addDays, bookedPrice, dailyFactor, dailyInterest, firstBusinessDayOfQuarter, interestBetween, interestOn, isBusinessDay, PRICE_ANCHOR_DAY, previousQuarter, QUARTER_INTEREST_MIN, quarterOf, unitsAtStart } from '../lib/treasury/history.ts';
import { TBILLS, UNIT } from '../lib/treasury/reference.ts';
import { quarterInterestDraft } from '../lib/treasury/sweep.ts';

const $ = (dollars, cents = 0) => BigInt(dollars) * 1_000_000n + BigInt(cents) * 10_000n;
const ON = { on: true, cushionMinor: $(5_000) };
const OFF = { on: false, cushionMinor: $(5_000) };

test('the daily factor is (1 + rate)^(1/365) in parts of 10^18, rounded down', () => {
  const g = dailyFactor(375);
  const S = 10n ** 18n;
  // g^365 ≤ 1.0375 < (g + 1)^365, all in integers.
  assert.ok(g ** 365n <= (10_375n * S ** 365n) / 10_000n);
  assert.ok((g + 1n) ** 365n > (10_375n * S ** 365n) / 10_000n);
  assert.equal(dailyFactor(0), S);
  assert.throws(() => dailyFactor(1.5));
});

test('the booked price is the test price on the day the rate is dated, and rises every day after', () => {
  assert.equal(bookedPrice(PRICE_ANCHOR_DAY), TBILLS.testPriceMinor);
  let prev = bookedPrice(addDays(PRICE_ANCHOR_DAY, -40));
  for (let i = -39; i <= 120; i++) {
    const p = bookedPrice(addDays(PRICE_ANCHOR_DAY, i));
    assert.equal(typeof p, 'bigint');
    assert.ok(p >= prev, `day ${i}: the price never falls`);
    prev = p;
  }
  // A year on, the price is up by the rate (to within a millionth of a dollar per day of rounding).
  const year = bookedPrice(addDays(PRICE_ANCHOR_DAY, 365));
  const want = (TBILLS.testPriceMinor * (10_000n + BigInt(TBILLS.rate.value.bps))) / 10_000n;
  assert.ok(want - year >= 0n && want - year <= 365n, `a year: ${year} against ${want}`);
});

test('units start gaining the day after they settle; units redeemed during a day still gained that day', () => {
  const events = [
    { at: '2026-07-10T09:00:00.000Z', kind: 'subscribe', unitsMicro: 1_000n * UNIT },
    { at: '2026-08-01T15:00:00.000Z', kind: 'redeem', unitsMicro: 400n * UNIT },
  ];
  assert.equal(unitsAtStart('2026-07-10', events), 0n);
  assert.equal(unitsAtStart('2026-07-11', events), 1_000n * UNIT);
  assert.equal(unitsAtStart('2026-08-01', events), 1_000n * UNIT);
  assert.equal(unitsAtStart('2026-08-02', events), 600n * UNIT);
  assert.equal(interestOn('2026-07-10', events), 0n);
  const day = interestOn('2026-07-11', events);
  assert.equal(day, (1_000n * UNIT * (bookedPrice('2026-07-11') - bookedPrice('2026-07-10'))) / UNIT);
  assert.ok(day > 0n);
});

test('the chart is the booked interest: its bars sum to the interest booked over the same days (integers)', () => {
  const events = [
    { at: '2026-06-02T00:00:00.000Z', kind: 'subscribe', unitsMicro: 25_000n * UNIT },
    { at: '2026-09-20T12:00:00.000Z', kind: 'subscribe', unitsMicro: 5_000n * UNIT },
    { at: '2026-10-03T08:00:00.000Z', kind: 'redeem', unitsMicro: 2_000n * UNIT },
  ];
  for (const days of [7, 30]) {
    const bars = dailyInterest('2026-10-14', days, events);
    assert.equal(bars.length, days);
    assert.equal(bars.at(-1).day, '2026-10-14');
    assert.equal(bars[0].day, addDays('2026-10-14', -(days - 1)));
    for (const b of bars) assert.equal(typeof b.interestMinor, 'bigint');
    const sum = bars.reduce((n, b) => n + b.interestMinor, 0n);
    assert.equal(sum, interestBetween(bars[0].day, '2026-10-14', events));
  }
  // 7 days and 30 days are different periods: their totals differ.
  const s7 = dailyInterest('2026-10-14', 7, events).reduce((n, b) => n + b.interestMinor, 0n);
  const s30 = dailyInterest('2026-10-14', 30, events).reduce((n, b) => n + b.interestMinor, 0n);
  assert.ok(s30 > s7);
});

test('calendar quarters and business days', () => {
  assert.deepEqual(quarterOf('2026-08-15'), { key: '2026-Q3', first: '2026-07-01', last: '2026-09-30', months: 'Jul–Sep' });
  assert.deepEqual(previousQuarter('2026-01-05'), { key: '2025-Q4', first: '2025-10-01', last: '2025-12-31', months: 'Oct–Dec' });
  assert.equal(isBusinessDay('2026-10-03'), false, 'a Saturday');
  assert.equal(isBusinessDay('2026-10-05'), true, 'a Monday');
  // 1 Oct 2026 is a Thursday; 1 Aug 2026 a Saturday (Q3 starts 1 Jul, a Wednesday); 1 Jan 2028 a Saturday.
  assert.equal(firstBusinessDayOfQuarter('2026-11-20'), '2026-10-01');
  assert.equal(firstBusinessDayOfQuarter('2028-02-01'), '2028-01-03');
});

test('the quarter draft: on the first business day after the quarter ends, the quarter’s booked interest, at least US$50, Sweep on only', () => {
  // Enough units that a quarter's interest clears US$50: about US$40,000 at ~3.75% a year.
  const events = [{ at: '2026-03-31T10:00:00.000Z', kind: 'subscribe', unitsMicro: 40_000n * UNIT }];
  const booked = interestBetween('2026-07-01', '2026-09-30', events);
  assert.ok(booked >= QUARTER_INTEREST_MIN, `the quarter booked ${booked}`);
  const d = quarterInterestDraft({ today: '2026-10-01', rule: ON, events, redeemableMinor: $(1_000_000) });
  assert.equal(d.kind, 'redeem');
  assert.equal(d.reason, 'quarter_interest');
  assert.equal(d.quarter.key, '2026-Q3');
  assert.equal(d.quarter.months, 'Jul–Sep');
  assert.equal(d.bookedMinor, booked);
  assert.equal(d.amountMinor, (booked / 10_000n) * 10_000n, 'whole cents, rounded down');
  // Hold drafts nothing; nor does the day before the first business day.
  assert.equal(quarterInterestDraft({ today: '2026-10-01', rule: OFF, events, redeemableMinor: $(1_000_000) }), null);
  assert.equal(quarterInterestDraft({ today: '2026-09-30', rule: ON, events, redeemableMinor: $(1_000_000) })?.quarter.key, '2026-Q2', 'on 30 Sep it is still Q3: the draft would be for Q2');
  // Never more than can be redeemed now.
  const capped = quarterInterestDraft({ today: '2026-10-01', rule: ON, events, redeemableMinor: $(60) });
  assert.equal(capped.amountMinor, $(60));
  // Under US$50 (its own minimum, not the US$500 sweep minimum): nothing.
  assert.equal(QUARTER_INTEREST_MIN, $(50));
  assert.equal(quarterInterestDraft({ today: '2026-10-01', rule: ON, events, redeemableMinor: $(49, 99) }), null);
  const small = [{ at: '2026-03-31T10:00:00.000Z', kind: 'subscribe', unitsMicro: 1_000n * UNIT }];
  assert.equal(quarterInterestDraft({ today: '2026-10-01', rule: ON, events: small, redeemableMinor: $(1_000_000) }), null);
});
