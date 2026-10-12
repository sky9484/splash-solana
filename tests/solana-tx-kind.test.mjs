// The chain client is shared across Next.js route bundles (globalThis), and each bundle can carry its
// own copy of @solana/web3.js. A v0 transaction built in one bundle is not `instanceof` another
// bundle's VersionedTransaction: the sponsor check read it as legacy and failed with
// "legacy.compileMessage is not a function" when account setup created a vault (found 13 Oct in the
// browser). Transaction kind and the simulator are now decided by shape.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

import { SOLANA_CONFIG } from '../lib/solana/config.ts';
import { defaultSponsorPolicy, validateSponsoredTransaction } from '../lib/solana/kora.ts';
import { buildMemoInstruction } from '../lib/solana/payout.ts';
import { isSimulator, SolanaSimulator } from '../lib/solana/simulator.ts';
import { buildSponsoredTransaction } from '../lib/solana/squads.ts';
import { isVersionedTransaction } from '../lib/solana/tx-kind.ts';

/** The same transaction, as another bundle's copy of the class would hand it over: same shape, other prototype. */
function fromAnotherBundle(tx) {
  class ForeignVersionedTransaction {
    constructor(src) {
      this.message = src.message;
      this.signatures = src.signatures;
    }
    serialize() {
      return new VersionedTransaction(this.message, this.signatures).serialize();
    }
  }
  return new ForeignVersionedTransaction(tx);
}

test('a v0 transaction from another copy of the class is still v0; a legacy one is still legacy', () => {
  const feePayer = Keypair.generate().publicKey;
  const v0 = buildSponsoredTransaction(feePayer, [buildMemoInstruction('splash:pay:v1:pay_0123456789abcdef')], PublicKey.default.toBase58());
  const foreign = fromAnotherBundle(v0);
  assert.equal(foreign instanceof VersionedTransaction, false, 'the premise: instanceof fails across copies');
  assert.equal(isVersionedTransaction(v0), true);
  assert.equal(isVersionedTransaction(foreign), true);
  assert.equal(isVersionedTransaction(new Transaction()), false);
});

test('the sponsor check reads a v0 transaction from another bundle instead of throwing', () => {
  const feePayer = Keypair.generate().publicKey;
  const v0 = buildSponsoredTransaction(feePayer, [buildMemoInstruction('splash:pay:v1:pay_0123456789abcdef')], PublicKey.default.toBase58());
  const policy = defaultSponsorPolicy(SOLANA_CONFIG.devnet.usdcMint);
  const here = validateSponsoredTransaction(v0, feePayer, policy);
  const there = validateSponsoredTransaction(fromAnotherBundle(v0), feePayer, policy);
  assert.deepEqual(there, here);
});

test('the simulator is recognised by its mode, and no service code asks instanceof', () => {
  assert.equal(isSimulator(new SolanaSimulator()), true);
  assert.equal(isSimulator({ mode: 'devnet' }), false);
  for (const file of ['lib/solana-app/service.ts', 'lib/solana/kora.ts', 'lib/solana/device-key.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /instanceof (SolanaSimulator|VersionedTransaction)\b/, `${file} must not decide by instanceof`);
  }
});
