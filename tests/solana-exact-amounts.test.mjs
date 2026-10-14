// Cent-rounded figures do not always add up: a batch's rows are exact micro-USDC, and twelve rows each
// rounded to the cent can differ from their exact total by a cent. The batch screen says so, shows the
// exact total, and its CSV carries every amount as an integer.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { usd, usdcExact, usdExact } = await import('../components/solana/client.ts');

test('usdcExact writes every unit of USDC, grouped, with no rounding', () => {
  assert.equal(usdcExact(5_416_082_957n), '5,416.082957 USDC');
  assert.equal(usdcExact('844276889'), '844.276889 USDC');
  assert.equal(usdcExact(1n), '0.000001 USDC');
  assert.equal(usdcExact(0n), '0.000000 USDC');
  assert.equal(usdcExact(-2_000_000n), '−2.000000 USDC');
});

test('usdExact is the same exact figure in the dashboard’s words (prompt 10 §0.6: US dollars)', () => {
  assert.equal(usdExact(5_416_082_957n), 'US$5,416.082957');
  assert.equal(usdExact('1'), 'US$0.000001');
  assert.equal(usdExact(-2_000_000n), '−US$2.000000');
});

test('rows rounded to the cent can drift from their rounded total, which is why the screen explains it', () => {
  // Three transfers of US$1.005 each: every row shows US$1.01, the three show US$3.03, the total is US$3.02.
  const rows = [1_005_000n, 1_005_000n, 1_005_000n];
  const exact = rows.reduce((a, b) => a + b, 0n);
  assert.deepEqual(rows.map((r) => usd(r)), ['US$1.01', 'US$1.01', 'US$1.01']);
  assert.equal(usd(exact), 'US$3.02');
  assert.equal(usdcExact(exact), '3.015000 USDC', 'the exact figure settles it');
});

test('the batch screen shows the exact total, explains the rounding, and exports integers', async () => {
  const src = await readFile(new URL('../components/solana/BatchFlow.tsx', import.meta.url), 'utf8');
  assert.match(src, /Exactly \{usdExact\(batch\.totals\.youPayMinor\)\}/);
  assert.match(src, /Amounts are rounded to the cent\./);
  assert.match(src, /'you_pay_usdc_minor'/);
  assert.match(src, /r\.youPayUsdcMinor, r\.splashFeeMinor/, 'the CSV writes the integers, not formatted strings');
  assert.doesNotMatch(src, /evidence pack has every exact amount/, 'batches have no evidence pack; the note must not promise one');
});
