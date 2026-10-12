import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('settlement evidence module defines encrypted Walrus-backed evidence bundles', async () => {
  const evidence = await source('lib/evidence/settlement.ts');

  assert.match(evidence, /splash\.settlement-evidence\.v2/);
  assert.match(evidence, /sealAndStoreSettlementEvidence/);
  assert.match(evidence, /sealAdapter\.encrypt/);
  assert.match(evidence, /storeEncryptedInvoice/);
  assert.match(evidence, /ciphertextHash: sha256\(ciphertext\)/);
});

test('Seal demo crypto is unavailable in production transfer runtime', async () => {
  const seal = await source('lib/evidence-sui/seal.ts');
  const runtimeMode = await source('lib/server/runtime-mode.ts');

  assert.match(seal, /canUseDemoCrypto/);
  assert.match(runtimeMode, /env\.NODE_ENV === 'production'/);

  // Behavioural, not source-text: a production deployment that has NOT declared
  // a demo posture must never reach for stand-in crypto. This is the invariant
  // that matters, and it still holds.
  const { canUseDemoCrypto } = await import('../lib/server/runtime-mode.ts');
  assert.equal(canUseDemoCrypto({ NODE_ENV: 'production' }), false);
  assert.equal(canUseDemoCrypto({ NODE_ENV: 'production', USE_MOCK_APIS: 'false' }), false);

  // A deployment that HAS declared one gets stand-in crypto, matching how
  // lib/env.ts already makes the vendor keys optional under the same flags.
  // The flags are the record of that decision.
  assert.equal(canUseDemoCrypto({ NODE_ENV: 'production', USE_MOCK_APIS: 'true' }), true);
  assert.equal(canUseDemoCrypto({ NODE_ENV: 'production', NEXT_PUBLIC_DEMO_MODE: 'true' }), true);
});

test('receipt exposes a collapsed independent settlement proof drawer', async () => {
  const drawer = await source('components/SettlementProofDrawer.tsx');
  const receiptStep = await source('components/transfer/StepReceipt.tsx');

  assert.match(drawer, /View independent settlement proof/);
  assert.match(drawer, /\/api\/audit\/\$\{transferIntentId\}/);
  assert.match(drawer, /Walrus blob/);
  assert.match(drawer, /Seal policy/);
  assert.match(drawer, /Hash match/);
  assert.match(receiptStep, /<SettlementProofDrawer/);
});
