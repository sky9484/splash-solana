// Prompt 12 §5.1: the receipt number is SPL-R-YYYYMMDD-XXXXXXXX, the issue day in Malaysia time and the
// first 8 hex of the receipt id, upper case. Display only; the id stays the key.
import assert from 'node:assert/strict';
import test from 'node:test';

const { receiptNumber } = await import('../lib/solana-app/receipt-number.ts');

test('the receipt number: the id’s first 8 hex upper-cased, the issue day in MYT, the same every time', () => {
  assert.equal(receiptNumber('rcpt_6512f659a0b1c2d3', '2026-10-18T03:20:00.000Z'), 'SPL-R-20261018-6512F659');
  assert.equal(receiptNumber('rcpt_6512f659a0b1c2d3', '2026-10-18T03:20:00.000Z'), receiptNumber('rcpt_6512f659a0b1c2d3', '2026-10-18T03:20:00.000Z'));
  // Only the first 8 hex count; the rest of the id does not change the number.
  assert.equal(receiptNumber('rcpt_6512f659ffffffff', '2026-10-18T03:20:00.000Z'), 'SPL-R-20261018-6512F659');
  // Digits stay digits; letters go upper case.
  assert.equal(receiptNumber('rcpt_abcdef0123456789', '2026-01-02T00:00:00Z'), 'SPL-R-20260102-ABCDEF01');
});

test('the day turns at midnight in Malaysia (UTC+8), not at midnight UTC', () => {
  // 23:59:59.999 on 18 Oct in MYT is 15:59:59.999 UTC.
  assert.equal(receiptNumber('rcpt_0000000a00000000', '2026-10-18T15:59:59.999Z'), 'SPL-R-20261018-0000000A');
  // 00:00 on 19 Oct in MYT is 16:00 UTC on the 18th.
  assert.equal(receiptNumber('rcpt_0000000a00000000', '2026-10-18T16:00:00.000Z'), 'SPL-R-20261019-0000000A');
  // An offset in the input means the same instant.
  assert.equal(receiptNumber('rcpt_0000000a00000000', '2026-10-19T00:00:00+08:00'), 'SPL-R-20261019-0000000A');
  // The year turns the same way.
  assert.equal(receiptNumber('rcpt_0000000a00000000', '2026-12-31T16:00:00Z'), 'SPL-R-20270101-0000000A');
});

test('anything that is not a receipt id or a time is refused, never guessed', () => {
  for (const id of ['rcpt_6512F659A0B1C2D3', 'rcpt_6512f659', 'shr_6512f659a0b1c2d3', '6512f659a0b1c2d3', 'rcpt_6512f659a0b1c2d3x']) {
    assert.throws(() => receiptNumber(id, '2026-10-18T03:20:00Z'), /not a receipt id/);
  }
  assert.throws(() => receiptNumber('rcpt_6512f659a0b1c2d3', 'yesterday'), /not a time/);
});
