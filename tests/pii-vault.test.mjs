// Prompt 10 Phase S §S.2: the vault and the key service. Envelope encryption round-trips; another
// company's or recipient's id, or one changed byte, fails; fingerprints are keyed and stable; the local
// key refuses production without the override; the AWS adapter works against a mocked client.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { afterEach, test } from 'node:test';

import { createAwsKms, awsKmsFromEnv } from '../lib/server/kms/aws.ts';
import { kmsFromEnv, resetKms } from '../lib/server/kms/index.ts';
import { createLocalKms, localKmsFromEnv } from '../lib/server/kms/local.ts';
import { fingerprintOf, normaliseAccountNumber, openNumber, rewrapDataKey, sealNumber, VaultError } from '../lib/server/pii-vault.ts';

const local = () => createLocalKms({ wrapKey: randomBytes(32), hmacKey: randomBytes(32) });
const who = { orgId: 'org_a', beneficiaryId: 'sup_1' };
const NUMBER = '0012 3456 7890';

afterEach(() => resetKms());

test('seal then open gives back the same number (digits only), and nothing readable is stored', async () => {
  const kms = local();
  const sealed = await sealNumber(kms, { ...who, bankCode: 'BPI', accountNumber: NUMBER });
  assert.equal(sealed.last4, '7890');
  assert.equal(sealed.nonce.length, 12);
  assert.equal(sealed.keyId, kms.keyId());
  assert.ok(!Buffer.from(sealed.ciphertext).toString('latin1').includes('001234567890'), 'the ciphertext is not the number');
  assert.ok(!Buffer.from(sealed.wrappedDataKey).toString('hex').includes(Buffer.from(sealed.ciphertext).toString('hex')));
  assert.equal(await openNumber(kms, sealed, who), '001234567890');
  // A new nonce and a new data key every time: the same number seals differently.
  const again = await sealNumber(kms, { ...who, bankCode: 'BPI', accountNumber: NUMBER });
  assert.notDeepEqual(again.nonce, sealed.nonce);
  assert.notDeepEqual(again.ciphertext, sealed.ciphertext);
  assert.equal(again.fingerprint, sealed.fingerprint);
});

test('opening with another company’s or another recipient’s id fails (the associated data)', async () => {
  const kms = local();
  const sealed = await sealNumber(kms, { ...who, bankCode: 'BPI', accountNumber: NUMBER });
  await assert.rejects(openNumber(kms, sealed, { orgId: 'org_b', beneficiaryId: 'sup_1' }), (e) => e instanceof VaultError && e.code === 'cannot_open');
  await assert.rejects(openNumber(kms, sealed, { orgId: 'org_a', beneficiaryId: 'sup_2' }), (e) => e instanceof VaultError && e.code === 'cannot_open');
  // Even with the data key unwrapped correctly, the number's own associated data refuses the move.
  const other = await sealNumber(kms, { orgId: 'org_b', beneficiaryId: 'sup_1', bankCode: 'BPI', accountNumber: '999988887777' });
  await assert.rejects(openNumber(kms, { ...sealed, wrappedDataKey: other.wrappedDataKey }, { orgId: 'org_b', beneficiaryId: 'sup_1' }), VaultError);
});

test('changing one byte of the ciphertext, the nonce or the wrapped key fails', async () => {
  const kms = local();
  const sealed = await sealNumber(kms, { ...who, bankCode: 'BPI', accountNumber: NUMBER });
  const flip = (b, i = 0) => {
    const c = new Uint8Array(b);
    c[i] ^= 0x01;
    return c;
  };
  for (const field of ['ciphertext', 'nonce', 'wrappedDataKey']) {
    for (const i of [0, sealed[field].length - 1]) {
      await assert.rejects(openNumber(kms, { ...sealed, [field]: flip(sealed[field], i) }, who), (e) => e instanceof VaultError && e.code === 'cannot_open', `${field}[${i}]`);
    }
  }
  // And the error never carries the number.
  const err = await openNumber(kms, { ...sealed, ciphertext: flip(sealed.ciphertext) }, who).catch((e) => e);
  assert.doesNotMatch(`${err.message} ${err.stack}`, /1234567890/);
});

test('fingerprints: same bank and number match, a different number or bank does not, and they are keyed', async () => {
  const kms = local();
  const a = await fingerprintOf(kms, 'BPI', '001234567890');
  assert.equal(await fingerprintOf(kms, ' bpi ', '0012-3456-7890'), a, 'normalised before the HMAC');
  assert.notEqual(await fingerprintOf(kms, 'BPI', '001234567891'), a);
  assert.notEqual(await fingerprintOf(kms, 'BDO', '001234567890'), a);
  assert.notEqual(await fingerprintOf(local(), 'BPI', '001234567890'), a, 'another HMAC key, another fingerprint: not a plain hash');
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('an account number is 6 to 20 digits; spaces and dashes are dropped', () => {
  assert.equal(normaliseAccountNumber('1234-5678 9012'), '123456789012');
  for (const bad of ['12345', '1'.repeat(21), '12345678a', '']) assert.throws(() => normaliseAccountNumber(bad), (e) => e instanceof VaultError && e.code === 'invalid_number');
});

test('a shredded record cannot be opened', async () => {
  const kms = local();
  const sealed = await sealNumber(kms, { ...who, bankCode: 'BPI', accountNumber: NUMBER });
  await assert.rejects(openNumber(kms, { ...sealed, ciphertext: null, wrappedDataKey: null, nonce: null }, who), (e) => e instanceof VaultError && e.code === 'shredded');
});

test('key rotation re-wraps the data key without the number: the new key opens it, the old one is not needed', async () => {
  const oldKms = local();
  const newKms = local();
  const sealed = await sealNumber(oldKms, { ...who, bankCode: 'BPI', accountNumber: NUMBER });
  const { wrappedDataKey, keyId } = await rewrapDataKey(oldKms, newKms, sealed, who);
  assert.equal(keyId, newKms.keyId());
  assert.equal(await openNumber(newKms, { ...sealed, wrappedDataKey }, who), '001234567890');
  await assert.rejects(openNumber(oldKms, { ...sealed, wrappedDataKey }, who), VaultError);
});

test('the local key: refused in production without the override; with it, a warning; both keys or neither', () => {
  const keys = { PII_LOCAL_WRAP_KEY: randomBytes(32).toString('base64'), PII_LOCAL_HMAC_KEY: randomBytes(32).toString('base64') };
  assert.throws(() => localKmsFromEnv(keys, { production: true, offline: false }), /refused in production/);
  const warned = [];
  const warn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    const kms = localKmsFromEnv({ ...keys, PII_ALLOW_LOCAL_IN_PROD: '1' }, { production: true, offline: false });
    assert.equal(kms.kind, 'local');
  } finally {
    console.warn = warn;
  }
  assert.ok(warned.some((w) => /LOCAL key in production/.test(w)), 'the exception is logged');
  assert.throws(() => localKmsFromEnv({ PII_LOCAL_WRAP_KEY: keys.PII_LOCAL_WRAP_KEY }, { production: false, offline: true }), /both/);
  assert.throws(() => localKmsFromEnv({ PII_LOCAL_WRAP_KEY: 'c2hvcnQ=', PII_LOCAL_HMAC_KEY: keys.PII_LOCAL_HMAC_KEY }, { production: false, offline: false }), /32 bytes/);
  assert.throws(() => localKmsFromEnv({}, { production: false, offline: false }), /PII_LOCAL_WRAP_KEY/, 'devnet without keys: told what to set');
  assert.throws(() => createLocalKms({ wrapKey: Buffer.alloc(32, 7), hmacKey: Buffer.alloc(32, 7) }), /different/);
});

test('offline with no keys: throwaway keys for this process, said once', async () => {
  const said = [];
  const info = console.info;
  console.info = (...a) => said.push(a.join(' '));
  try {
    const kms = kmsFromEnv({ SPLASH_SOLANA_MODE: 'offline', NODE_ENV: 'development' });
    assert.equal(kms.kind, 'local');
    assert.equal(kmsFromEnv({ SPLASH_SOLANA_MODE: 'offline', NODE_ENV: 'development' }), kms, 'one per process');
    const sealed = await sealNumber(kms, { ...who, bankCode: 'BPI', accountNumber: NUMBER });
    assert.equal(await openNumber(kms, sealed, who), '001234567890');
  } finally {
    console.info = info;
  }
  assert.ok(said.filter((s) => /throwaway/.test(s)).length <= 1);
  assert.throws(() => kmsFromEnv({ PII_KMS: 'vault' }), /local" or "aws/);
});

/* AWS KMS, against a mocked client shaped like the SDK. */
function mockAws() {
  const master = createLocalKms({ wrapKey: randomBytes(32), hmacKey: randomBytes(32) });
  const calls = [];
  const ctxOf = (ec) => ({ orgId: ec.org, beneficiaryId: ec.beneficiary });
  return {
    calls,
    port: {
      async encrypt(i) {
        calls.push(['encrypt', i.KeyId, i.EncryptionContext]);
        return { CiphertextBlob: await master.wrap(i.Plaintext, ctxOf(i.EncryptionContext)), KeyId: i.KeyId };
      },
      async decrypt(i) {
        calls.push(['decrypt', i.KeyId, i.EncryptionContext]);
        return { Plaintext: await master.unwrap(i.CiphertextBlob, ctxOf(i.EncryptionContext)), KeyId: i.KeyId };
      },
      async generateMac(i) {
        calls.push(['generateMac', i.KeyId, i.MacAlgorithm]);
        return { Mac: await master.hmac(i.Message) };
      },
    },
  };
}
const ARN = 'arn:aws:kms:ap-southeast-1:123456789012:key/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
const HMAC_ARN = 'arn:aws:kms:ap-southeast-1:123456789012:key/1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809';

test('the AWS adapter, with a mocked client: Encrypt/Decrypt bound to the company and recipient, GenerateMac for fingerprints', async () => {
  const aws = mockAws();
  const kms = createAwsKms({ keyArn: ARN, hmacKeyArn: HMAC_ARN, port: aws.port });
  assert.equal(kms.kind, 'aws');
  assert.equal(kms.keyId(), ARN);
  const sealed = await sealNumber(kms, { ...who, bankCode: 'BPI', accountNumber: NUMBER });
  assert.equal(await openNumber(kms, sealed, who), '001234567890');
  await assert.rejects(openNumber(kms, sealed, { orgId: 'org_b', beneficiaryId: 'sup_1' }), VaultError);
  assert.deepEqual(aws.calls[0], ['encrypt', ARN, { purpose: 'splash-bank-number', org: 'org_a', beneficiary: 'sup_1' }]);
  assert.deepEqual(aws.calls.find((c) => c[0] === 'generateMac'), ['generateMac', HMAC_ARN, 'HMAC_SHA_256']);
  assert.ok(aws.calls.some((c) => c[0] === 'decrypt' && c[2].org === 'org_b'), 'the wrong company is asked for, and KMS refuses');
});

test('the AWS adapter keeps bank numbers in ap-southeast-1, with two different keys, and says what to install', async () => {
  assert.throws(() => createAwsKms({ keyArn: ARN.replace('ap-southeast-1', 'us-east-1'), hmacKeyArn: HMAC_ARN, port: mockAws().port }), /ap-southeast-1/);
  assert.throws(() => createAwsKms({ keyArn: ARN, hmacKeyArn: ARN, port: mockAws().port }), /two different/);
  assert.throws(() => createAwsKms({ keyArn: 'key-123', hmacKeyArn: HMAC_ARN, port: mockAws().port }), /ARN/);
  assert.throws(() => awsKmsFromEnv({ PII_KMS: 'aws' }), /PII_AWS_KMS_KEY_ARN/);
  // The SDK is not a dependency until the switch: the first use says how to get it.
  const kms = awsKmsFromEnv({ PII_KMS: 'aws', PII_AWS_KMS_KEY_ARN: ARN, PII_AWS_HMAC_KEY_ARN: HMAC_ARN });
  await assert.rejects(kms.hmac(new Uint8Array(1)), /npm install @aws-sdk\/client-kms|KMS|credential|region/i);
});
