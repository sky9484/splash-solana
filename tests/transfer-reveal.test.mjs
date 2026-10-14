// Prompt 10 §5.3: "Show number" shows a full account number for 30 seconds, then masks it again: at the
// server's expiry, when the sheet closes, and when the tab is hidden. Driven with a fake clock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';

import { createReveal, revealSecondsLeft } from '../components/solana/transfer/reveal.ts';

function fakeClock() {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T09:00:00Z') });
  return { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) };
}

function watch() {
  const seen = [];
  return { seen, onChange: (shown, reason) => seen.push(shown ? { shown: shown.number } : { masked: reason }) };
}

test('it masks itself at the server’s expiry, with a countdown on the way', (t) => {
  const clock = fakeClock();
  t.after(() => mock.timers.reset());
  const w = watch();
  const r = createReveal(clock, w.onChange);
  r.show('004122074471', '2026-10-14T09:00:30Z');
  assert.equal(r.current().number, '004122074471');
  assert.equal(revealSecondsLeft(r.current(), clock.now()), 30);
  mock.timers.tick(29_000);
  assert.equal(revealSecondsLeft(r.current(), clock.now()), 1);
  assert.ok(r.current(), 'still shown at 29 s');
  mock.timers.tick(1_000);
  assert.equal(r.current(), null, 'masked at 30 s');
  assert.deepEqual(w.seen, [{ shown: '004122074471' }, { masked: 'expired' }]);
  assert.equal(revealSecondsLeft(r.current(), clock.now()), 0);
});

test('closing the sheet masks it at once, and the timer can’t bring it back', (t) => {
  const clock = fakeClock();
  t.after(() => mock.timers.reset());
  const w = watch();
  const r = createReveal(clock, w.onChange);
  r.show('004122074471', '2026-10-14T09:00:30Z');
  mock.timers.tick(5_000);
  r.close();
  assert.equal(r.current(), null);
  mock.timers.tick(60_000);
  assert.deepEqual(w.seen, [{ shown: '004122074471' }, { masked: 'closed' }], 'masked once, on close; nothing after');
});

test('hiding the tab masks it; showing the tab again does not', (t) => {
  const clock = fakeClock();
  t.after(() => mock.timers.reset());
  const w = watch();
  const r = createReveal(clock, w.onChange);
  r.show('004122074471', '2026-10-14T09:00:30Z');
  r.visibility(false);
  assert.ok(r.current(), 'a visible tab changes nothing');
  r.visibility(true);
  assert.equal(r.current(), null);
  r.visibility(false);
  assert.equal(r.current(), null, 'coming back does not show it again');
  assert.deepEqual(w.seen, [{ shown: '004122074471' }, { masked: 'hidden' }]);
});

test('an expiry already past shows nothing', (t) => {
  const clock = fakeClock();
  t.after(() => mock.timers.reset());
  const w = watch();
  const r = createReveal(clock, w.onChange);
  r.show('004122074471', '2026-10-14T08:59:59Z');
  assert.equal(r.current(), null);
  assert.deepEqual(w.seen, [{ masked: 'expired' }]);
});

test('the sheet wires the reveal to the tab’s visibility and to closing', () => {
  // The wiring is one hook (prompt 10 Phase 4), shared by a recipient's sheet and Check the invoice.
  const src = readFileSync('components/solana/transfer/useReveal.ts', 'utf8');
  for (const user of ['components/solana/transfer/RecipientSheets.tsx', 'components/solana/invoices/CheckInvoice.tsx']) {
    const page = readFileSync(user, 'utf8');
    assert.match(page, /useReveal\(/, `${user} shows a number through the shared hook`);
    assert.doesNotMatch(page, /localStorage|sessionStorage|console\.(log|info|debug)/, `${user} never stores or logs it`);
  }
  assert.match(src, /addEventListener\('visibilitychange'/);
  assert.match(src, /if \(!open\) ctl\.close\(\)/, 'a closed sheet masks the number');
  assert.match(src, /removeEventListener\('visibilitychange'[\s\S]{0,80}ctl\.close\(\)/, 'leaving the page masks it too');
  assert.doesNotMatch(src, /localStorage|sessionStorage|console\.(log|info|debug)/, 'the number is never stored or logged in the browser');
});
