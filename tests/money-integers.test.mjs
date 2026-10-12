// Prompt 07 §0.6 and §9: money is integers. Amounts are bigint minor units (USDC 6 decimals, pesos
// 2), and nothing in the route engine, the Solana code or the fee code turns them into a binary
// float. A float operation may appear only where ALLOWED says what it computes and why that is not an
// amount. Comments and string literals are stripped first, so "0.10%" in copy is not a finding.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

/** lib/route-engine holds the fee code (fees.ts); lib/solana-app is the service that moves the money. */
const ROOTS = ['lib/route-engine', 'lib/solana', 'lib/solana-app'];

const FLOAT = [
  { name: 'parseFloat', pattern: /\bparseFloat\s*\(/ },
  { name: 'toFixed', pattern: /\.toFixed\s*\(/ },
  { name: 'Number(…)', pattern: /(?<![\w.])Number\s*\(/ },
  { name: 'Math rounding', pattern: /\bMath\.(?:round|floor|ceil|trunc)\s*\(/ },
  { name: 'a decimal literal', pattern: /(?<![\w.])\d[\d_]*\.\d[\d_]*(?![\w.])/ },
];

/** file → a fragment of the one line allowed, what it computes, and why it is not an amount. */
const ALLOWED = [
  { file: 'lib/route-engine/fees.ts', has: "Number(divRound(allInMinor * 1_000_000n, ticketUsdcMinor, 'half-up')) / 100", why: 'all-in cost in basis points for display, divided from integer minor units and never fed back into an amount' },
  { file: 'lib/solana-app/service.ts', has: 'Number((minor * 1_000_000n) / ticket) / 100', why: 'bpsOf: a fee shown as basis points, from integer division' },
  { file: 'lib/solana-app/service.ts', has: 'new Date(Math.floor(t / 86_400_000) * 86_400_000)', why: 'the start of a UTC day in milliseconds, for the daily limit window' },
  { file: 'lib/solana-app/payment-repo.ts', has: 'Number(r.lastValidBlockHeight)', why: 'a block height from Postgres bigint; web3.js takes a number' },
  { file: 'lib/solana/compute-budget.ts', has: 'Math.ceil((unitsConsumed * (100 + SIMULATION_MARGIN_PCT)) / 100)', why: 'compute units with a safety margin, not money' },
  { file: 'lib/solana/compute-budget.ts', has: 'Math.ceil(withMargin / 1_000) * 1_000', why: 'compute units rounded up to the next thousand' },
  { file: 'lib/solana/compute-budget.ts', has: 'Math.round(Number.isFinite(estimateMicroLamports)', why: 'the RPC returns its priority-fee estimate as a JS number; it is rounded once into a bigint of micro-lamports and stays bigint' },
  { file: 'lib/solana/compute-budget.ts', has: 'Math.floor(fees.length * 0.75)', why: 'the index of the 75th percentile in a sorted list' },
  { file: 'lib/solana/kora.ts', has: 'Math.floor(Date.now() / 1000)', why: 'a unix timestamp in seconds for the request signature' },
  { file: 'lib/solana/recovery-kit.ts', has: 'Number(part.slice(0, -1))', why: 'a hardened index in a derivation path' },
  { file: 'lib/solana/recovery-kit.ts', has: 'Math.floor(0x100000000 / maxExclusive) * maxExclusive', why: 'the rejection-sampling bound for an unbiased random word index' },
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name).replaceAll('\\', '/');
    if (statSync(full).isDirectory()) return files(full);
    return extname(name) === '.ts' ? [full] : [];
  });
}

/** Code only: no comments, and every string literal emptied. */
function strip(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, '') + m.at(-1))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function findings(file, text) {
  const raw = text.split(/\r?\n/);
  const out = [];
  strip(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const rule of FLOAT) {
        if (!rule.pattern.test(line)) continue;
        if (ALLOWED.some((a) => a.file === file && (raw[i] ?? '').includes(a.has))) continue;
        out.push(`${file}:${i + 1} [${rule.name}] ${(raw[i] ?? '').trim().slice(0, 110)}`);
      }
    });
  return out;
}

test('no float math on money in the route engine, the Solana code or the fee code', () => {
  const scanned = ROOTS.flatMap(files);
  assert.ok(scanned.includes('lib/route-engine/fees.ts'), 'the fee code is in scope');
  const found = scanned.flatMap((f) => findings(f, readFileSync(f, 'utf8')));
  assert.deepEqual(found, [], `\n  ${found.join('\n  ')}\n`);
});

test('every allowed float is still there, so the list cannot quietly grow stale', () => {
  for (const { file, has, why } of ALLOWED) {
    assert.ok(readFileSync(file, 'utf8').includes(has), `${file} no longer has \`${has}\` (${why}); remove it from ALLOWED`);
  }
});

test('the check catches float money and ignores copy and comments', () => {
  const f = (src) => findings('x.ts', src).length;
  assert.equal(f('const usd = parseFloat(input);'), 1);
  assert.equal(f('const shown = amount.toFixed(2);'), 1);
  assert.equal(f('const fee = Number(amountMinor) * 0.001;'), 2);
  assert.equal(f('const pesos = Math.round(usd * rate);'), 1);
  assert.equal(f("const label = '0.10% Splash fee';"), 0, 'copy in a string');
  assert.equal(f('// 0.10% of the amount, Math.round never'), 0, 'a comment');
  assert.equal(f('const ok = Number.isSafeInteger(n);'), 0, 'a Number.* predicate is not a conversion');
  assert.equal(f('const fee = (amountMinor * 10n) / 10_000n;'), 0, 'bigint arithmetic');
});
