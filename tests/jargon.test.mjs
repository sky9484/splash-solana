// Prompt 10 §0.6: the plain-language rule. The term list (lib/copy/jargon.ts) catches the crypto words
// and lets ordinary words through; the recorded count only goes down; the target is 15% of the baseline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { jargonIn } from '../lib/copy/jargon.ts';

const words = (s) => jargonIn(s).map((h) => h.match);

test('the crypto words are caught, whole words, any case', () => {
  assert.deepEqual(words('Add USDC to your vault on Solana'), ['USDC', 'vault', 'Solana']);
  assert.deepEqual(words('Sign the transaction with your device key'), ['Sign', 'device key']);
  assert.deepEqual(words('Proof anchored on-chain · see Solscan'), ['anchored', 'on-chain', 'Solscan']);
  assert.deepEqual(words('Earn 4% APY yield').sort(), ['APY', 'Earn', 'yield']);
  assert.deepEqual(words('Paid by CCTP V2 through Polygon'), ['CCTP V2', 'Polygon']);
});

test('ordinary words pass: sign in, design, learn, a contract signed, file paths', () => {
  assert.deepEqual(words('Sign in to Splash, or sign out'), []);
  assert.deepEqual(words('The partner name is shown once signed'), []);
  assert.deepEqual(words('Design, learn, translate, striped'), []);
  assert.deepEqual(words('/cinematic/vault-transparent.png'), []);
  assert.deepEqual(words('var(--mint) and iso-fill-mint'), []);
});

test('the recorded count only goes down, and the target is 15% of the baseline', () => {
  const b = JSON.parse(readFileSync('docs/design/jargon-baseline.json', 'utf8'));
  assert.equal(b.targetMax, Math.floor(b.baseline * 0.15));
  assert.ok(b.current <= b.baseline);
  for (let i = 1; i < b.history.length; i++) assert.ok(b.history[i].count <= b.history[i - 1].count, 'each phase lowers it or leaves it flat');
  const lint = JSON.parse(readFileSync('package.json', 'utf8')).scripts.lint;
  assert.match(lint, /check:jargon/);
  assert.match(lint, /check:iso/);
});
