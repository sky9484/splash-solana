import assert from 'node:assert/strict';
import test from 'node:test';

import { assessKyt } from '../lib/funding/kyt-policy.ts';
import { selectDeepestSafeRoute } from '../lib/funding/normalization-policy.ts';

test('regulated VASP requires Travel Rule originator data', () => {
  const pending = assessKyt({ sourceType: 'regulated_vasp', riskScore: 10, amountUsd: 1000, selfCustodyStagedLimitUsd: 10000 });
  assert.equal(pending.outcome, 'PENDING_KYT');
  assert.equal(pending.policy, 'STANDARD');

  const cleared = assessKyt({ sourceType: 'regulated_vasp', riskScore: 10, travelRuleOriginatorCaptured: true, amountUsd: 1000, selfCustodyStagedLimitUsd: 10000 });
  assert.equal(cleared.outcome, 'CLEARED');
});

test('self-custody uses enhanced KYT and staged provenance controls', () => {
  const pending = assessKyt({ sourceType: 'self_custody', riskScore: 10, amountUsd: 1000, selfCustodyStagedLimitUsd: 10000 });
  assert.equal(pending.outcome, 'PENDING_KYT');
  assert.equal(pending.policy, 'ENHANCED');

  const cleared = assessKyt({ sourceType: 'self_custody', riskScore: 10, sourceOfFundsTraced: true, amountUsd: 1000, selfCustodyStagedLimitUsd: 10000 });
  assert.equal(cleared.outcome, 'CLEARED');
});

test('bad senders are quarantined', () => {
  const result = assessKyt({ sourceType: 'self_custody', riskScore: 90, sourceOfFundsTraced: true, amountUsd: 1000, selfCustodyStagedLimitUsd: 10000 });
  assert.equal(result.outcome, 'QUARANTINED');
});

test('normalization selects the deepest route inside the shared guard', () => {
  const selected = selectDeepestSafeRoute([
    { venue: 'CETUS', amountInMicro: 1_000_000, amountOutMicro: 999_000, depthMicro: 2_000_000 },
    { venue: 'AFTERMATH', amountInMicro: 1_000_000, amountOutMicro: 998_000, depthMicro: 5_000_000 },
    { venue: 'BLUEFIN', amountInMicro: 1_000_000, amountOutMicro: 900_000, depthMicro: 8_000_000 },
  ], { maxSlippageBps: 50, minDepthMicro: 1_000_000 });
  assert.equal(selected?.venue, 'AFTERMATH');
  assert.equal(selected?.effectiveSlippageBps, 20);
});

test('normalization aborts when every route trips depth or slippage', () => {
  const selected = selectDeepestSafeRoute([
    { venue: 'CETUS', amountInMicro: 1_000_000, amountOutMicro: 900_000, depthMicro: 2_000_000 },
  ], { maxSlippageBps: 50, minDepthMicro: 5_000_000 });
  assert.equal(selected, null);
});
