import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

/* explorer.ts reads process.env at call time, so each case sets the network
   and imports fresh via a cache-busting query. */
async function withNetwork(network, fn) {
  const before = process.env.SUI_NETWORK;
  process.env.SUI_NETWORK = network;
  try {
    const m = await import(`../lib/explorer.ts?n=${network}-${Math.random()}`);
    await fn(m);
  } finally {
    if (before === undefined) delete process.env.SUI_NETWORK;
    else process.env.SUI_NETWORK = before;
  }
}

const DIGEST = '0x' + '1'.repeat(64);
const ADDRESS = '0x' + '2'.repeat(64);

test('mainnet SuiVision has no subdomain — the mistake this replaced', async () => {
  await withNetwork('mainnet', (m) => {
    // Four call sites built `https://${network}.suivision.xyz/…`, which on
    // mainnet resolves to a host that does not exist. Every mainnet URL here
    // is bare suivision.xyz.
    assert.equal(m.suiVisionTxUrl(DIGEST), `https://suivision.xyz/txblock/${DIGEST}`);
    assert.equal(m.suiVisionAccountUrl(ADDRESS), `https://suivision.xyz/account/${ADDRESS}`);
    assert.equal(m.suiVisionObjectUrl(ADDRESS), `https://suivision.xyz/object/${ADDRESS}`);
    for (const url of [m.suiVisionTxUrl(DIGEST), m.suiVisionAccountUrl(ADDRESS), m.suiVisionObjectUrl(ADDRESS)]) {
      assert.doesNotMatch(url, /mainnet\.suivision/);
    }
  });
});

test('Suiscan keeps the network in the path, on both networks', async () => {
  await withNetwork('mainnet', (m) => {
    assert.equal(m.suiScanTxUrl(DIGEST), `https://suiscan.xyz/mainnet/tx/${DIGEST}`);
    assert.equal(m.suiScanBaseUrl(), 'https://suiscan.xyz/mainnet');
  });
  await withNetwork('testnet', (m) => {
    assert.equal(m.suiScanTxUrl(DIGEST), `https://suiscan.xyz/testnet/tx/${DIGEST}`);
    assert.equal(m.suiScanBaseUrl(), 'https://suiscan.xyz/testnet');
  });
});

test('testnet keeps its subdomain', async () => {
  await withNetwork('testnet', (m) => {
    assert.equal(m.suiVisionTxUrl(DIGEST), `https://testnet.suivision.xyz/txblock/${DIGEST}`);
  });
});

test('there is no mainnet faucet, and the helper says so rather than linking to one', async () => {
  await withNetwork('mainnet', (m) => assert.equal(m.faucetUrl(ADDRESS), null));
  await withNetwork('testnet', (m) => {
    assert.equal(m.faucetUrl(ADDRESS), `https://faucet.testnet.sui.io/?address=${ADDRESS}`);
  });
});

test('an unset network is testnet, never mainnet', async () => {
  const before = process.env.SUI_NETWORK;
  delete process.env.SUI_NETWORK;
  try {
    const m = await import(`../lib/explorer.ts?unset=${Math.random()}`);
    assert.equal(m.explorerNetwork(), 'testnet');
  } finally {
    if (before !== undefined) process.env.SUI_NETWORK = before;
  }
});

test('no application file builds an explorer URL by hand', () => {
  // The point of the module: one definition of which explorer. A receipt whose
  // "verify this yourself" link points at the wrong chain proves nothing, and
  // that is what four hardcoded testnet hosts would have done on mainnet.
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
        if (/suivision\.xyz|suiscan\.xyz|faucet\.testnet\.sui\.io/.test(text)) offenders.push(rel);
      }
    }
  };
  for (const root of ['app', 'components', 'lib']) walk(root);
  assert.deepEqual(offenders, [], `these build explorer URLs directly — use lib/explorer.ts: ${offenders.join(', ')}`);
});
