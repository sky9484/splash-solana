// Prompt 12 §5.5: the monthly statement as a book. Months are Malaysia time; the Treasury book carries
// T-bills at what went in plus the interest booked on them (posted at month end and before a
// redemption), and posts a sale's result against average cost, so every month adds up and the book
// never drifts from what moved.
import assert from 'node:assert/strict';
import test from 'node:test';

const { buildStatement, defaultStatementMonth, mytMonth, monthStart, statementMonths } = await import('../lib/solana-app/statement.ts');
const { interestOn } = await import('../lib/treasury/history.ts');

const order = (o) => ({ asset: 'usdy', path: 'market', priceMovedBps: null, holdUntil: null, createdBy: 'Aisyah', expiresAt: o.at, nonce: 'n', sweepDraftId: null, approval: null, settlement: { signatures: [], simulated: true, at: o.at }, state: 'settled', createdAt: o.at, priceMinor: 1_000_000n, from: null, landsIn: 'investments', receiptId: null, ...o });

function company() {
  return {
    id: 'acme',
    companyName: 'Acme Manufacturing',
    personName: 'Aisyah',
    createdAt: '2026-08-10T02:00:00.000Z',
    fundings: [{ signature: 'f1', amountMinor: 50_000_000_000n, at: '2026-08-11T03:00:00.000Z', simulated: true, note: 'Test USDC from the simulator' }],
    treasuryFundings: [{ signature: 't1aaaaaaaaaaaa', amountMinor: 20_000_000_000n, at: '2026-08-12T03:00:00.000Z', simulated: true, note: 'x' }],
    moves: [{ id: 'mv1', orgId: 'acme', from: 'payments', to: 'treasury', amountMinor: 5_000_000_000n, state: 'confirmed', updatedAt: '2026-09-02T04:00:00.000Z' }],
    investments: {
      lots: [],
      orders: [
        // 10,000 US$ of T-bills from the Reserve, then all of them redeemed into Payments a month on.
        order({ id: 'o1', kind: 'subscribe', amountMinor: 10_000_000_000n, unitsMicro: 10_000_000_000n, from: { reserveMinor: 10_000_000_000n, paymentsMinor: 0n }, at: '2026-08-20T05:00:00.000Z' }),
        order({ id: 'o2', kind: 'redeem', amountMinor: 10_040_000_000n, unitsMicro: 10_000_000_000n, landsIn: 'payments', at: '2026-09-25T05:00:00.000Z' }),
      ],
    },
    received: [],
    suppliers: [],
  };
}

const input = (org, month, account, now = new Date('2026-10-19T03:00:00.000Z')) => ({ org, payments: [], invoices: new Map(), evidence: new Map(), requests: new Map(), batches: new Map(), month, account, now });
const adds = (s) => s.openingMinor + s.summary.inMinor - s.summary.paymentsOutMinor - s.summary.feesMinor + s.summary.interestMinor + s.summary.movesMinor + s.summary.resultsMinor === s.closingMinor;

test('months are Malaysia time: the month turns at 00:00 UTC+8, and only months the company existed in are offered', () => {
  assert.equal(mytMonth('2026-09-30T15:59:59.999Z'), '2026-09');
  assert.equal(mytMonth('2026-09-30T16:00:00.000Z'), '2026-10');
  assert.equal(monthStart('2026-10'), Date.parse('2026-09-30T16:00:00.000Z'));
  assert.deepEqual(statementMonths('2026-08-10T02:00:00.000Z', new Date('2026-10-19T03:00:00Z')), ['2026-08', '2026-09', '2026-10']);
  assert.equal(defaultStatementMonth('2026-08-10T02:00:00.000Z', new Date('2026-10-19T03:00:00Z')), '2026-09', 'the last full month');
  assert.equal(defaultStatementMonth('2026-10-02T02:00:00.000Z', new Date('2026-10-19T03:00:00Z')), '2026-10', 'a company younger than a month: its first month');
});

test('every month of every account adds up, and each month opens where the last one closed', () => {
  const org = company();
  for (const account of ['payments', 'treasury', 'all']) {
    let closed = 0n;
    for (const month of ['2026-08', '2026-09', '2026-10']) {
      const s = buildStatement(input(org, month, account));
      assert.ok(adds(s), `${account} ${month} adds up`);
      assert.equal(s.openingMinor, closed, `${account} ${month} opens at the last close`);
      let running = s.openingMinor;
      for (const l of s.lines) {
        running += l.inMinor - l.outMinor;
        assert.equal(l.balanceAfterMinor, running);
      }
      assert.equal(running, s.closingMinor);
      closed = s.closingMinor;
    }
  }
});

test('the Treasury book: interest booked from the daily figures, posted at month end and before the redemption, and the sale result against cost', () => {
  const org = company();
  const aug = buildStatement(input(org, '2026-08', 'treasury'));
  const sep = buildStatement(input(org, '2026-09', 'treasury'));
  // The interest lines are the daily figures, summed over each posting's days.
  const units = [{ at: '2026-08-20T05:00:00.000Z', kind: 'subscribe', unitsMicro: 10_000_000_000n }, { at: '2026-09-25T05:00:00.000Z', kind: 'redeem', unitsMicro: 10_000_000_000n }];
  let augInterest = 0n;
  for (let d = Date.parse('2026-08-20T00:00:00Z'); d <= Date.parse('2026-08-31T00:00:00Z'); d += 86_400_000) augInterest += interestOn(new Date(d).toISOString().slice(0, 10), units);
  assert.ok(augInterest > 0n);
  assert.equal(aug.summary.interestMinor, augInterest);
  let sepInterest = 0n;
  for (let d = Date.parse('2026-09-01T00:00:00Z'); d <= Date.parse('2026-09-25T00:00:00Z'); d += 86_400_000) sepInterest += interestOn(new Date(d).toISOString().slice(0, 10), units);
  assert.equal(sep.summary.interestMinor, sepInterest, 'September: up to the redemption day');
  const interestLines = sep.lines.filter((l) => l.description === 'Interest booked on US Treasury bills');
  assert.equal(interestLines.length, 1, 'posted right before the redemption; nothing left to post at month end');
  assert.equal(interestLines[0].at, '2026-09-25T05:00:00.000Z');
  // Sold for 10,040; the book held 10,000 + the interest booked: the difference is the result.
  assert.equal(sep.summary.resultsMinor, 10_040_000_000n - (10_000_000_000n + augInterest + sepInterest));
  // In August the subscription moved money from the Reserve to the Investments account: no line, both are Treasury.
  assert.equal(aug.lines.filter((l) => /Investments/.test(l.description)).length, 0);
  // After the redemption the T-bills are gone, and the book is what the Reserve holds: 20,000 added
  // + 5,000 moved in from Payments. The interest and the result add up to the 40 the redemption made
  // over cost, and the 10,040 it paid went to Payments.
  const oct = buildStatement(input(org, '2026-10', 'treasury'));
  assert.equal(oct.openingMinor, 15_000_000_000n);
  assert.equal(aug.summary.interestMinor + sep.summary.interestMinor + sep.summary.resultsMinor, 40_000_000n);
  assert.deepEqual(oct.lines, []);
});

test('a batch payout leaves the Payments account chunk by chunk: each confirmed chunk and its fees, when its execute was confirmed', () => {
  const org = company();
  const chunk = (index, state, at, payoutMinor, feeMinor, rows) => ({ index, state, payoutMinor, feeMinor, rowIds: Array.from({ length: rows }, (_, i) => `r${index}.${i}`), calls: at ? [{ step: 'proposal', status: 'confirmed', at: '2026-10-05T01:00:00.000Z' }, { step: 'execute', status: 'confirmed', at }] : [] });
  const batch = { id: 'bat_1', orgId: 'acme', updatedAt: '2026-10-05T02:00:00.000Z', chunks: [chunk(0, 'confirmed', '2026-10-05T01:30:00.000Z', 3_000_000_000n, 9_000_000n, 8), chunk(1, 'failed', null, 1_000_000_000n, 3_000_000n, 4), chunk(2, 'confirmed', '2026-10-05T01:40:00.000Z', 500_000_000n, 1_500_000n, 1)] };
  const other = { ...batch, id: 'bat_2', orgId: 'northwind' };
  const s = buildStatement({ ...input(org, '2026-10', 'payments'), batches: new Map([['bat_1', batch], ['bat_2', other]]) });
  const mine = s.lines.filter((l) => /^(Batch payout|Fees, batch payout)/.test(l.description));
  assert.deepEqual(mine.map((l) => [l.description, l.at, l.outMinor]), [
    ['Batch payout, part 1 of 3, 8 suppliers', '2026-10-05T01:30:00.000Z', 3_000_000_000n],
    ['Fees, batch payout part 1', '2026-10-05T01:30:00.000Z', 9_000_000n],
    ['Batch payout, part 3 of 3, 1 supplier', '2026-10-05T01:40:00.000Z', 500_000_000n],
    ['Fees, batch payout part 3', '2026-10-05T01:40:00.000Z', 1_500_000n],
  ], 'the failed chunk moved nothing, and another company’s batch is not here');
  assert.equal(s.summary.paymentsOutMinor, 3_500_000_000n);
  assert.equal(s.summary.feesMinor, 10_500_000n);
  assert.ok(adds(s));
});

test('All leaves out the moves between Payments and Treasury: they change neither total', () => {
  const org = company();
  const sep = { p: buildStatement(input(org, '2026-09', 'payments')), t: buildStatement(input(org, '2026-09', 'treasury')), a: buildStatement(input(org, '2026-09', 'all')) };
  assert.equal(sep.a.closingMinor, sep.p.closingMinor + sep.t.closingMinor);
  assert.equal(sep.a.summary.movesMinor, 0n);
  assert.ok(sep.a.lines.every((l) => !/^(To|From) your (Reserve|Payments account|Investments account)/.test(l.description)));
});
