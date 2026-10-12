import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

import { explainChecks } from '../lib/solana-zeke/checker.ts';
import { assertDraftOnly } from '../lib/solana-zeke/guard.ts';
import * as checker from '../lib/solana-zeke/checker.ts';
import * as guard from '../lib/solana-zeke/guard.ts';
import * as reader from '../lib/solana-zeke/reader.ts';
import * as router from '../lib/solana-zeke/router.ts';

/**
 * Prompt 07 §5.2 (item 6): Zeke's only output is a draft, and the build fails the moment any module
 * under lib/solana-zeke/** can reach a signer, a sender or the fee payer. Checked on the import
 * graph itself, not only on export names, so a new file cannot slip in through a helper.
 */

const ZEKE_DIR = 'lib/solana-zeke';

function zekeFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (['.ts', '.tsx', '.mjs', '.js'].includes(extname(name))) out.push(full.replaceAll('\\', '/'));
    }
  };
  walk(ZEKE_DIR);
  return out;
}

/** Value imports (not `import type`), static or dynamic. */
function valueImports(text) {
  const found = [];
  for (const m of text.matchAll(/^\s*import\s+(?!type\b)[^'";]*?from\s*['"]([^'"]+)['"]/gm)) found.push(m[1]);
  for (const m of text.matchAll(/^\s*export\s+(?!type\b)[^'";]*?from\s*['"]([^'"]+)['"]/gm)) found.push(m[1]);
  for (const m of text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) found.push(m[1]);
  for (const m of text.matchAll(/import\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) found.push(m[1]);
  for (const m of text.matchAll(/require\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) found.push(m[1]);
  return found;
}

/** Anything that can sign, send, or ask the fee payer. */
const FORBIDDEN = [
  /^@solana\/web3\.js$/, // Keypair, sendTransaction, sign…
  /^@solana\/kit$/,
  /^@solana\/signers$/,
  /^@sqds\/multisig$/, // Squads instructions
  /(^|\/)solana\/(kora|simulator|squads|device-key|payout|cctp-v2-solana|recovery-kit)(\.ts)?$/,
  /(^|\/)solana-app\//, // the service that holds the send path
  /(^|\/)evidence-sui\//,
  /^@mysten\//,
];

test('no module under lib/solana-zeke can import a signer, a sender, Squads instructions or Kora', () => {
  const files = zekeFiles();
  assert.ok(files.length >= 4, `found ${files.length} Zeke files`);
  const offenders = [];
  for (const file of files) {
    for (const spec of valueImports(readFileSync(file, 'utf8'))) {
      if (FORBIDDEN.some((re) => re.test(spec))) offenders.push(`${file} imports ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the import check catches every form it claims to, and lets type-only imports through', () => {
  const sample = [
    "import { Keypair } from '@solana/web3.js';",
    "import * as multisig from '@sqds/multisig';",
    "export { createKoraClient } from '../solana/kora.ts';",
    "const m = await import('../solana-app/service.ts');",
    "import type { RouteQuote } from '../solana/types.ts';",
  ].join('\n');
  const specs = valueImports(sample);
  assert.deepEqual(specs.filter((s) => FORBIDDEN.some((re) => re.test(s))), ['@solana/web3.js', '@sqds/multisig', '../solana/kora.ts', '../solana-app/service.ts']);
  assert.ok(!specs.includes('../solana/types.ts'), 'a type-only import is not a capability');
});

test('no Zeke module exports anything that signs, sends, approves or executes', () => {
  for (const mod of [reader, router, guard, checker]) {
    for (const name of Object.keys(mod)) {
      assert.doesNotMatch(name, /sign|send|execute|submit|transfer|approve|broadcast|pay(?!load)/i, `Zeke exports ${name}`);
    }
  }
  assert.deepEqual(guard.ZEKE_AUTHORITY.tools, []);
});

/* ------------------------------------------------------------------ the Checker */

const passing = [
  { name: 'tier', passed: true, detail: 'tier advanced' },
  { name: 'per_payment_limit', passed: true, detail: '' },
  { name: 'daily_limit', passed: true, detail: '' },
  { name: 'kyt', passed: true, detail: '' },
  { name: 'duplicate_invoice', passed: true, detail: '' },
  { name: 'quote_expiry', passed: true, detail: '' },
  { name: 'bank_details_verified', passed: true, detail: '' },
];

test('the Checker explains deterministic results in plain words, and is a draft', () => {
  const out = explainChecks({ tier: 'advanced', checks: passing, extraChecks: [{ name: 'amount_covers_invoice', passed: true, detail: '' }], screeningLabel: 'KYT stub · not a real screening' });
  assert.doesNotThrow(() => assertDraftOnly(out));
  assert.equal(out.blocked, false);
  assert.match(out.summary, /All 8 checks passed\. A person still approves/);
  assert.match(out.lines.find((l) => l.check === 'kyt').text, /KYT stub · not a real screening/, 'the stub says what it is');
  assert.equal(out.lines.length, 8);
});

test('the Checker cannot turn a no into a yes: it only says why', () => {
  const failing = passing.map((c) => (c.name === 'bank_details_verified' ? { ...c, passed: false } : c));
  const out = explainChecks({ tier: 'advanced', checks: failing, screeningLabel: 'KYT stub · not a real screening' });
  assert.equal(out.blocked, true);
  assert.match(out.summary, /^Blocked: The bank details are new and not verified/);
  assert.match(out.summary, /Zeke cannot change this/);
  // Deterministic: the same input, the same words.
  assert.deepEqual(explainChecks({ tier: 'advanced', checks: failing, screeningLabel: 'x' }), explainChecks({ tier: 'advanced', checks: failing, screeningLabel: 'x' }));
  for (const line of out.lines) assert.doesNotMatch(line.text, /guaranteed|instant|licensed|gasless/i);
});
