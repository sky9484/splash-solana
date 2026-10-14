// Prompt 11 Phase 5 review: a route is called "Cheapest" only when it costs less than every other route
// shown; on a tie neither is (components/solana/transfer/shared.ts laneTags).
import assert from 'node:assert/strict';
import test from 'node:test';

import { laneTags } from '../components/solana/transfer/shared.ts';

const lane = (quoteId, labels, policies, youPay) => ({ quoteId, labels, policies, youPayUsdcMinor: String(youPay) });

test('"Cheapest" only when strictly cheaper than every other route', () => {
  const a = lane('a', ['Cheapest', 'Fastest'], ['cheapest', 'fastest'], 1_311_240_000);
  const b = lane('b', [], [], 1_312_000_000);
  assert.deepEqual(laneTags(a, [a, b]), [{ label: 'Cheapest', policy: 'cheapest' }, { label: 'Fastest', policy: 'fastest' }]);
  // The same cost: the engine's tie-break still names one of them; the page doesn't.
  const tie = lane('b', [], [], 1_311_240_000);
  assert.deepEqual(laneTags(a, [a, tie]), [{ label: 'Fastest', policy: 'fastest' }]);
  const onlyCheapest = lane('c', ['Cheapest'], ['cheapest'], 1_000);
  assert.deepEqual(laneTags(onlyCheapest, [onlyCheapest, lane('d', ['Fastest'], ['fastest'], 1_000)]), [], 'nothing left: the card says "Other route"');
  // One route alone is the cheapest shown.
  assert.deepEqual(laneTags(onlyCheapest, [onlyCheapest]), [{ label: 'Cheapest', policy: 'cheapest' }]);
});
