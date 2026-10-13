import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/** Prompt 07 §5.7: the devnet proof script runs --dry-run offline and prints the plan. */

test('scripts/solana-devnet-proof.ts --dry-run walks the whole money path offline and writes nothing', () => {
  const before = readFileSync('docs/solana-build/devnet-run.json', 'utf8');
  const out = execFileSync(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-strip-types', '--import', './scripts/alias-hook.mjs', 'scripts/solana-devnet-proof.ts', '--dry-run'],
    { encoding: 'utf8', env: { ...process.env, SPLASH_SOLANA_MODE: '', DATABASE_URL: '' }, timeout: 120_000 },
  );
  assert.match(out, /DRY RUN \(offline simulator, nothing written\)/);
  const record = JSON.parse(out.slice(out.indexOf('\n{') + 1, out.lastIndexOf('}') + 1));
  assert.equal(record.mode, 'offline');
  assert.equal(record.simulated, true);
  assert.deepEqual(record.statePath, ['draft', 'quoted', 'checked', 'proposed', 'approved', 'executed', 'confirmed', 'partner_paid', 'evidenced', 'anchored']);
  assert.ok(record.chainCalls.every((c) => c.status === 'finalized' && c.explorerUrl === null && c.solscanUrl === null), 'simulated calls carry no explorer or Solscan link');
  assert.equal(record.memo, `splash:pay:v1:${record.paymentId}`, 'the memo to look for on Solscan');
  assert.equal(record.vault.solscanUrl, null);
  assert.match(record.evidence.sasAttestationAddress, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.equal(readFileSync('docs/solana-build/devnet-run.json', 'utf8'), before, 'a dry run writes nothing');
});

test('the live run refuses to start without devnet mode', () => {
  assert.throws(
    () => execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-strip-types', '--import', './scripts/alias-hook.mjs', 'scripts/solana-devnet-proof.ts'], { encoding: 'utf8', env: { ...process.env, SPLASH_SOLANA_MODE: '' }, stdio: 'pipe' }),
    (e) => e.status === 2 && /needs SPLASH_SOLANA_MODE=devnet/.test(String(e.stderr)),
  );
});
