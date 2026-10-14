// Prompt 10 Phase 3, CRIT-1 (docs/solana-build/FUNDING-AUDIT.md): the legacy funding API handed out a
// CCTP deposit address that was not the company's own account. Every route answers 410 before reading
// anything, no answer carries an address, and the code that derived the address is gone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROUTES = [
  ['../app/api/funding/sessions/route.ts', ['POST']],
  ['../app/api/funding/sessions/[id]/route.ts', ['GET', 'POST']],
  ['../app/api/funding/deposits/route.ts', ['POST']],
  ['../app/api/funding/usd-deposits/route.ts', ['POST']],
  ['../app/api/funding/options/route.ts', ['GET']],
];

test('every legacy funding route answers 410 Gone, and no answer holds a deposit address', async () => {
  for (const [path, methods] of ROUTES) {
    const mod = await import(path);
    for (const m of methods) {
      const res = await mod[m](new Request('http://localhost/api/funding/x', { method: m, ...(m === 'POST' ? { body: JSON.stringify({ rail: 'CCTP', sourceChain: 'BASE', amountUsd: 100 }), headers: { 'content-type': 'application/json' } } : {}) }), { params: Promise.resolve({ id: 'fund_1' }) });
      assert.equal(res.status, 410, `${path} ${m}`);
      const text = await res.text();
      assert.doesNotMatch(text, /0x[0-9a-fA-F]{40}/, 'no EVM deposit address');
      assert.doesNotMatch(text, /data:image|qr/i, 'no QR code');
      assert.equal(JSON.parse(text).code, 'gone');
    }
  }
});

test('the code that derived a non-company CCTP address is gone, and a CCTP session is refused', async () => {
  const src = readFileSync(new URL('../lib/server/funding-sessions.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /readConfiguredCctpAddress/);
  assert.doesNotMatch(src, /createHash\(/, 'no derived demo address either');
  const { createFundingSession } = await import('../lib/server/funding-sessions.ts');
  const cctp = { source: 'USDC', type: 'stablecoin', asset: 'USDC', rail: 'CCTP', sourceChain: 'BASE', feeTier: 'DISCOUNT' };
  assert.throws(
    () => createFundingSession({ orgId: 'org_a', businessAccountId: 'ba_1', selection: cctp, amountExpectedMicro: 1_000_000, vaultAddress: 'Vault1111111111111111111111111111111111111' }, { NODE_ENV: 'development' }),
    (e) => /lands only in your own Payments account/.test(e.message) && !/0x[0-9a-f]{40}/i.test(e.message),
  );
});
