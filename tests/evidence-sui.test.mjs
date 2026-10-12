import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { Transaction } from '@mysten/sui/transactions';

import { BrowserDecryptOnlyError, liveSealAdapter, mockSealAdapter, sealIdentity } from '../lib/evidence-sui/seal.ts';
import { SponsorRefusedError, assertSponsorable, evidenceSponsorFromEnv } from '../lib/evidence-sui/sponsor.ts';
import { walrusEpochs } from '../lib/evidence-sui/walrus.ts';

/*
 * The evidence layer on the Solana build (prompt 07 §4): Seal encrypts on the
 * server, decrypts only in the member's browser; the Sui sponsor pays for
 * allowlist calls and nothing else; Walrus keeps evidence for the configured
 * period. This is the one test file allowed to import @mysten directly
 * (to build a sponsored transaction kind).
 */

const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('live Seal never decrypts on the server', async () => {
  await assert.rejects(liveSealAdapter.decrypt('ciphertext', 'SEAL:00', 'ops@acme.com'), BrowserDecryptOnlyError);
});

test('the server holds no key that can open a Seal session', async () => {
  const seal = code(await readFile(new URL('../lib/evidence-sui/seal.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(seal, /SessionKey|getOperatorKeypair|OPERATOR_SUI_PRIVATE_KEY|signPersonalMessage/);
  assert.doesNotMatch(seal, /sui-settlement|@\/lib\/sui['"]/);
});

test('demo mode still round-trips, labelled demo', async () => {
  const { ciphertext, policy } = await mockSealAdapter.encrypt('{"kind":3}', ['ops@acme.com']);
  assert.equal(policy.mode, 'demo');
  assert.ok(policy.policyId.startsWith('DEMO_SEAL_'));
  assert.equal(await mockSealAdapter.decrypt(ciphertext, policy.policyId, 'ops@acme.com'), '{"kind":3}');
  assert.equal(await mockSealAdapter.decrypt(ciphertext, policy.policyId, 'stranger@else.com'), null);
});

test('a Seal identity is the allowlist object id followed by a nonce', () => {
  const allowlist = `0x${'ab'.repeat(32)}`;
  const id = sealIdentity(allowlist, new Uint8Array([1, 2, 3, 4, 5]));
  assert.equal(id, `${'ab'.repeat(32)}0102030405`);
});

const PKG = `0x${'42'.repeat(32)}`;

async function kindBytes(build) {
  const tx = new Transaction();
  build(tx);
  return tx.build({ onlyTransactionKind: true });
}

test('the sponsor signs allowlist calls and nothing else', async () => {
  // Pure arguments only, so the kind builds offline (an object argument would need its version from a node).
  const ok = await kindBytes((tx) => tx.moveCall({ target: `${PKG}::allowlist::add`, arguments: [tx.pure.address(`0x${'02'.repeat(32)}`)] }));
  assert.doesNotThrow(() => assertSponsorable(ok, PKG));

  const otherModule = await kindBytes((tx) => tx.moveCall({ target: `${PKG}::evidence::anything`, arguments: [] }));
  assert.throws(() => assertSponsorable(otherModule, PKG), SponsorRefusedError);

  const otherPackage = await kindBytes((tx) => tx.moveCall({ target: `0x${'99'.repeat(32)}::allowlist::add`, arguments: [] }));
  assert.throws(() => assertSponsorable(otherPackage, PKG), SponsorRefusedError);

  const drainGas = await kindBytes((tx) => {
    const [coin] = tx.splitCoins(tx.gas, [1_000_000]);
    tx.transferObjects([coin], `0x${'03'.repeat(32)}`);
  });
  assert.throws(() => assertSponsorable(drainGas, PKG), /SplitCoins|TransferObjects/);

  assert.throws(() => assertSponsorable(ok, ''), /not published/);
});

test('the sponsor key from env is refused on mainnet', () => {
  const key = 'suiprivkey1qzwant2qv5gpcpcaxkqxtt9xwtzph2sv5jajyxq0ug6cq8e6gyvzqu8e9pa'; // throwaway test key, no funds anywhere
  assert.equal(evidenceSponsorFromEnv({}), null);
  assert.throws(() => evidenceSponsorFromEnv({ EVIDENCE_SPONSOR_SUI_PRIVATE_KEY: key, EVIDENCE_SUI_NETWORK: 'mainnet' }), SponsorRefusedError);
});

test('Walrus keeps evidence for WALRUS_EPOCHS (default 53), stored permanent', async () => {
  assert.equal(walrusEpochs({}), 53);
  assert.equal(walrusEpochs({ WALRUS_EPOCHS: '104' }), 104);
  assert.equal(walrusEpochs({ WALRUS_EPOCHS: '0' }), 53);
  const walrus = code(await readFile(new URL('../lib/evidence-sui/walrus.ts', import.meta.url), 'utf8'));
  assert.match(walrus, /\/v1\/blobs\?epochs=\$\{epochs\}&permanent=true/);
});
