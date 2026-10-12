// Prompt 07 §9: every screen a business or admin sees (landing, login/signup, dashboard, admin) runs on
// Solana. Sui survives only as an invisible dependency of the evidence module, so its name reaches a
// screen in exactly the places listed in ALLOWED below, each with its reason. Comments and module
// paths (`@/lib/evidence-sui/…`) are code, not copy, and are stripped before the check.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

const PATTERN = /\bSui\b|zkLogin|SuiScan/i;
const EXT = new Set(['.ts', '.tsx']);

/** The four surfaces §9 names, so a renamed folder can't make the check pass by scanning nothing. */
const SURFACES = {
  landing: ['app/page.tsx', 'components/IsometricLanding.tsx', 'components/landing'],
  auth: ['app/login', 'app/signup', 'app/forgot-password', 'app/reset-password', 'app/verify-email', 'components/auth'],
  dashboard: ['app/dashboard', 'components/dashboard', 'components/solana'],
  admin: ['app/admin', 'app/api/admin', 'components/admin'],
};

/** file → the one line of copy that may name Sui there, and why. */
const ALLOWED = [
  {
    file: 'app/api/admin/wallet/route.ts',
    line: /role: 'Sui sponsor \(evidence only\)'/,
    why: 'the admin wallet screen labels the server key that pays Sui gas for Seal allowlist updates',
  },
  {
    file: 'components/compliance/TrustCompliance.tsx',
    line: /kept on a separate storage network that runs on Sui/,
    why: 'the /trust evidence paragraph (prompt 07 §4.2 acceptance) says where the encrypted record lives',
  },
];

function files(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return EXT.has(extname(path)) ? [path] : [];
  return readdirSync(path).flatMap((name) => files(join(path, name).replaceAll('\\', '/')));
}

function strip(text) {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/(['"`])[^'"`\n]*evidence-sui[^'"`\n]*\1/g, "''");
}

function hits(file) {
  return strip(readFileSync(file, 'utf8'))
    .split(/\r?\n/)
    .map((line, i) => ({ file, n: i + 1, line: line.trim() }))
    .filter(({ line }) => PATTERN.test(line))
    .filter(({ line }) => !ALLOWED.some((a) => a.file === file && a.line.test(line)));
}

for (const [surface, roots] of Object.entries(SURFACES)) {
  test(`no Sui, zkLogin or SuiScan on the ${surface} screens`, () => {
    const scanned = roots.flatMap(files);
    assert.ok(scanned.length > 0, `${surface}: nothing to scan, so the check would pass vacuously`);
    const found = scanned.flatMap(hits).map(({ file, n, line }) => `${file}:${n} ${line.slice(0, 110)}`);
    assert.deepEqual(found, [], `\n  ${found.join('\n  ')}\n`);
  });
}

test('nowhere else in app/ or components/ either, outside the allowlist', () => {
  const found = [...files('app'), ...files('components')]
    .flatMap(hits)
    .map(({ file, n, line }) => `${file}:${n} ${line.slice(0, 110)}`);
  assert.deepEqual(found, [], `\n  ${found.join('\n  ')}\n`);
});

test('every allowlist entry is still needed, so the list cannot quietly grow stale', () => {
  for (const { file, line, why } of ALLOWED) {
    const text = strip(readFileSync(file, 'utf8'));
    assert.match(text, line, `${file} no longer carries the allowed line (${why}); remove it from ALLOWED`);
  }
});

test('the check sees through nothing it should not', () => {
  const sample = (text) => strip(text).split('\n').filter((l) => PATTERN.test(l));
  assert.equal(sample("<p>Settled on Sui</p>").length, 1);
  assert.equal(sample("<a>View on SuiScan</a>").length, 1);
  assert.equal(sample("<button>Continue with zkLogin</button>").length, 1);
  assert.equal(sample("import { x } from '@/lib/evidence-sui/seal';").length, 0, 'a module path is not copy');
  assert.equal(sample('// Sui gas for allowlist updates only').length, 0, 'a comment is not copy');
});
