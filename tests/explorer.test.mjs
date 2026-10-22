import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

/* explorer.ts reads process.env at call time, so each case sets the cluster
   and imports fresh via a cache-busting query. */
async function withCluster(cluster, fn) {
  const before = process.env.SOLANA_CLUSTER;
  if (cluster === undefined) delete process.env.SOLANA_CLUSTER;
  else process.env.SOLANA_CLUSTER = cluster;
  try {
    const m = await import(`../lib/explorer.ts?c=${cluster}-${Math.random()}`);
    await fn(m);
  } finally {
    if (before === undefined) delete process.env.SOLANA_CLUSTER;
    else process.env.SOLANA_CLUSTER = before;
  }
}

const SIGNATURE = '55pHme5Q' + '1'.repeat(80);
const ADDRESS = '9fZ34EK7' + '2'.repeat(36);

test('devnet links carry the cluster; mainnet-beta links carry none', async () => {
  await withCluster('devnet', (m) => {
    assert.equal(m.solanaTxUrl(SIGNATURE), `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`);
    assert.equal(m.solanaAddressUrl(ADDRESS), `https://explorer.solana.com/address/${ADDRESS}?cluster=devnet`);
    assert.equal(m.solanaExplorerBaseUrl(), 'https://explorer.solana.com/?cluster=devnet');
  });
  await withCluster('mainnet-beta', (m) => {
    assert.equal(m.solanaTxUrl(SIGNATURE), `https://explorer.solana.com/tx/${SIGNATURE}`);
    assert.equal(m.solanaAddressUrl(ADDRESS), `https://explorer.solana.com/address/${ADDRESS}`);
  });
});

test('Solscan, the trace link shown first: devnet carries the cluster, mainnet-beta none', async () => {
  await withCluster('devnet', (m) => {
    assert.equal(m.solscanTxUrl(SIGNATURE), `https://solscan.io/tx/${SIGNATURE}?cluster=devnet`);
    assert.equal(m.solscanAccountUrl(ADDRESS), `https://solscan.io/account/${ADDRESS}?cluster=devnet`);
    assert.equal(m.solscanTxUrl('a/b?c'), 'https://solscan.io/tx/a%2Fb%3Fc?cluster=devnet');
  });
  await withCluster('mainnet-beta', (m) => {
    assert.equal(m.solscanTxUrl(SIGNATURE), `https://solscan.io/tx/${SIGNATURE}`);
    assert.equal(m.solscanAccountUrl(ADDRESS), `https://solscan.io/account/${ADDRESS}`);
  });
});

test('an unset cluster is devnet, never mainnet', async () => {
  await withCluster(undefined, (m) => assert.equal(m.explorerCluster(), 'devnet'));
});

test('a value that is not a signature cannot break out of the path', async () => {
  await withCluster('devnet', (m) => {
    assert.equal(m.solanaTxUrl('a/b?c'), 'https://explorer.solana.com/tx/a%2Fb%3Fc?cluster=devnet');
  });
});

test('there is no mainnet faucet, and the helper says so rather than linking to one', async () => {
  await withCluster('mainnet-beta', (m) => assert.equal(m.faucetUrl(), null));
  await withCluster('devnet', (m) => assert.equal(m.faucetUrl(), 'https://faucet.circle.com/'));
});

test('no application file builds an explorer URL by hand', () => {
  // One definition of which explorer: a receipt whose "verify this yourself"
  // link points at the wrong network proves nothing.
  const EXT = new Set(['.ts', '.tsx']);
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (EXT.has(extname(name))) {
        const rel = full.replaceAll('\\', '/');
        if (rel.endsWith('lib/explorer.ts')) continue;
        const text = readFileSync(full, 'utf8');
        if (/explorer\.solana\.com|solscan\.io|suivision\.xyz|suiscan\.xyz/.test(text)) offenders.push(rel);
      }
    }
  };
  for (const root of ['app', 'components', 'lib']) walk(root);
  assert.deepEqual(offenders, [], `these build explorer URLs directly — use lib/explorer.ts: ${offenders.join(', ')}`);
});
