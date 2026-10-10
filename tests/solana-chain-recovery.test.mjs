// Recovery kit: BIP39 + SLIP-0010 against official vectors, word confirmation, proof of possession.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToSeedSync } from '@scure/bip39';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Keypair } from '@solana/web3.js';

import {
  RECOVERY_WORD_COUNT,
  SOLANA_DERIVATION_PATH,
  confirmWords,
  createMemoryNonceStore,
  createPossessionChallenge,
  deriveRecoveryKey,
  generateRecoveryWords,
  isValidRecoveryWords,
  parseHardenedPath,
  pickConfirmationIndices,
  recoveryWordsToSeed,
  signPossessionChallenge,
  slip10DeriveEd25519,
  slip10PublicKey,
} from '../lib/solana/recovery-kit.ts';

const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => Uint8Array.from(Buffer.from(h, 'hex'));

// satoshilabs/slips slip-0010.md, "Test vector 1 for ed25519" and "Test vector 2 for ed25519".
const SLIP10_V1 = {
  seed: '000102030405060708090a0b0c0d0e0f',
  nodes: [
    ['m', '90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb', '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7', '00a4b2856bfec510abab89753fac1ac0e1112364e7d250545963f135f2a33188ed'],
    ["m/0'", '8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69', '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3', '008c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c'],
    ["m/0'/1'", 'a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14', 'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2', '001932a5270f335bed617d5b935c80aedb1a35bd9fc1e31acafd5372c30f5c1187'],
    ["m/0'/1'/2'", '2e69929e00b5ab250f49c3fb1c12f252de4fed2c1db88387094a0f8c4c9ccd6c', '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9', '00ae98736566d30ed0e9d2f4486a64bc95740d89c7db33f52121f8ea8f76ff0fc1'],
    ["m/0'/1'/2'/2'", '8f6d87f93d750e0efccda017d662a1b31a266e4a6f5993b15f5c1f07f74dd5cc', '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662', '008abae2d66361c879b900d204ad2cc4984fa2aa344dd7ddc46007329ac76c429c'],
    ["m/0'/1'/2'/2'/1000000000'", '68789923a0cac2cd5a29172a475fe9e0fb14cd6adb5ad98a3fa70333e7afa230', '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793', '003c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a'],
  ],
};
const SLIP10_V2 = {
  seed: 'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542',
  nodes: [
    ['m', 'ef70a74db9c3a5af931b5fe73ed8e1a53464133654fd55e7a66f8570b8e33c3b', '171cb88b1b3c1db25add599712e36245d75bc65a1a5c9e18d76f9f2b1eab4012', '008fe9693f8fa62a4305a140b9764c5ee01e455963744fe18204b4fb948249308a'],
    ["m/0'", '0b78a3226f915c082bf118f83618a618ab6dec793752624cbeb622acb562862d', '1559eb2bbec5790b0c65d8693e4d0875b1747f4970ae8b650486ed7470845635', '0086fab68dcb57aa196c77c5f264f215a112c22a912c10d123b0d03c3c28ef1037'],
    ["m/0'/2147483647'", '138f0b2551bcafeca6ff2aa88ba8ed0ed8de070841f0c4ef0165df8181eaad7f', 'ea4f5bfe8694d8bb74b7b59404632fd5968b774ed545e810de9c32a4fb4192f4', '005ba3b9ac6e90e83effcd25ac4e58a1365a9e35a3d3ae5eb07b9e4d90bcf7506d'],
    ["m/0'/2147483647'/1'", '73bd9fff1cfbde33a1b846c27085f711c0fe2d66fd32e139d3ebc28e5a4a6b90', '3757c7577170179c7868353ada796c839135b3d30554bbb74a4b1e4a5a58505c', '002e66aa57069c86cc18249aecf5cb5a9cebbfd6fadeab056254763874a9352b45'],
  ],
};

for (const [name, v] of [['vector 1', SLIP10_V1], ['vector 2', SLIP10_V2]]) {
  test(`SLIP-0010 ed25519 official ${name}`, () => {
    for (const [path, chainCode, priv, pub] of v.nodes) {
      const node = slip10DeriveEd25519(unhex(v.seed), path);
      assert.equal(hex(node.chainCode), chainCode, `${path} chain code`);
      assert.equal(hex(node.key), priv, `${path} private`);
      assert.equal(hex(slip10PublicKey(node.key)), pub, `${path} public`);
    }
  });
}

test('BIP39 official vector: 24-word "abandon ... art" with passphrase TREZOR', () => {
  // trezor/python-mnemonic vectors.json, english, entropy 00..00 (256 bits).
  const words = `${'abandon '.repeat(23)}art`;
  assert.ok(isValidRecoveryWords(words));
  assert.equal(
    hex(recoveryWordsToSeed(words, 'TREZOR')),
    'bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8',
  );
});

test("deriveRecoveryKey = SLIP-0010 at m/44'/501'/0'/0' over the BIP39 seed (no passphrase)", () => {
  const words = `${'abandon '.repeat(23)}art`;
  const seed = mnemonicToSeedSync(words, '');
  const node = slip10DeriveEd25519(seed, SOLANA_DERIVATION_PATH);
  const key = deriveRecoveryKey(words);
  assert.equal(hex(key.publicKeyBytes), hex(ed25519.getPublicKey(node.key)));
  // The 64-byte export is a valid web3.js Keypair for the same address.
  const secret = key.exportSecretKeyForKeypair();
  assert.equal(Keypair.fromSecretKey(secret).publicKey.toBase58(), key.publicKey);
  secret.fill(0);
  // Deterministic: same words, same key.
  assert.equal(deriveRecoveryKey(words).publicKey, key.publicKey);
  key.destroy();
  assert.throws(() => key.sign(new Uint8Array([1])), /destroyed/);
});

test('generated kits are 24 valid words, unique, and sign verifiably', () => {
  const a = generateRecoveryWords();
  const b = generateRecoveryWords();
  assert.equal(a.length, RECOVERY_WORD_COUNT);
  assert.ok(isValidRecoveryWords(a));
  assert.notDeepEqual(a, b);
  const key = deriveRecoveryKey(a);
  const msg = new TextEncoder().encode('hello');
  assert.ok(ed25519.verify(key.sign(msg), msg, key.publicKeyBytes));
  key.destroy();
});

test('paths: only fully hardened paths are accepted', () => {
  assert.deepEqual(parseHardenedPath("m/44'/501'/0'/0'"), [44, 501, 0, 0].map((n) => n + 0x80000000));
  assert.throws(() => parseHardenedPath("m/44'/501'/0'/0"), /hardened/);
  assert.throws(() => parseHardenedPath('x/1'), /Bad derivation path/);
  assert.throws(() => recoveryWordsToSeed(`${'abandon '.repeat(23)}abandon`), /not a valid/);
});

test('confirmWords: exactly three distinct correct words', () => {
  const words = generateRecoveryWords();
  const idx = pickConfirmationIndices();
  assert.equal(idx.length, 3);
  assert.equal(new Set(idx).size, 3);
  assert.ok(idx.every((i) => i >= 0 && i < 24));
  const picks = idx.map((index) => ({ index, word: words[index] }));
  assert.equal(confirmWords(words, picks), true);
  assert.equal(confirmWords(words, picks.map((p) => ({ ...p, word: ` ${p.word.toUpperCase()} ` }))), true, 'case/space-insensitive');
  assert.equal(confirmWords(words, [picks[0], picks[1], { index: picks[2].index, word: 'zzzz' }]), false, 'one wrong word');
  assert.equal(confirmWords(words, picks.slice(0, 2)), false, 'too few');
  assert.equal(confirmWords(words, [picks[0], picks[0], picks[1]]), false, 'duplicate index');
  assert.equal(confirmWords(words, [{ index: 24, word: 'x' }, picks[0], picks[1]]), false, 'out of range');
});

test('proof of possession: good signature once, then replay / expiry / wrong key refused', async () => {
  const key = deriveRecoveryKey(generateRecoveryWords());
  const nonces = createMemoryNonceStore();
  const now = new Date('2026-10-11T00:00:00Z');
  const c = createPossessionChallenge('org_1', key.publicKey, now, 300);
  assert.match(c.nonce, /^[0-9a-f]{64}$/);
  const sig = await signPossessionChallenge(key, c);
  const { verifyPossession } = await import('../lib/solana/recovery-kit.ts');
  assert.deepEqual(await verifyPossession(c, key.publicKey, sig, nonces, now), { ok: true });
  assert.equal((await verifyPossession(c, key.publicKey, sig, nonces, now)).reason, 'replayed');

  const c2 = createPossessionChallenge('org_1', key.publicKey, now, 300);
  const sig2 = await signPossessionChallenge(key, c2);
  assert.equal((await verifyPossession(c2, key.publicKey, sig2, nonces, new Date(now.getTime() + 301_000))).reason, 'expired');

  const other = deriveRecoveryKey(generateRecoveryWords());
  const c3 = createPossessionChallenge('org_1', key.publicKey, now);
  const forged = await signPossessionChallenge(other, c3);
  assert.equal((await verifyPossession(c3, key.publicKey, forged, nonces, now)).reason, 'bad_signature');
  assert.equal((await verifyPossession(c3, other.publicKey, forged, nonces, now)).reason, 'key_mismatch');
  // A failed attempt does not burn the nonce: the real holder can still answer c3.
  assert.deepEqual(await verifyPossession(c3, key.publicKey, await signPossessionChallenge(key, c3), nonces, now), { ok: true });
  assert.equal((await verifyPossession(c3, key.publicKey, 'not-base58-0OIl', nonces, now)).reason, 'malformed');
  key.destroy();
  other.destroy();
});
