import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

/**
 * One module owns Sui (prompt 07 §4.1, §4.2). Settlement is Solana; Sui is
 * the evidence layer only — Seal encryption and Walrus storage — and lives in
 * lib/evidence-sui/. These checks fail the build if that stops being true:
 *
 *   1. no file outside lib/evidence-sui imports a Mysten package, statically
 *      or dynamically (ESLint's no-restricted-imports catches the static
 *      case in the editor; this catches both, and `require`);
 *   2. the removed Sui settlement dependencies stay removed;
 *   3. the §4.2 grep over app, components and lib finds Sui only where the
 *      evidence layer is meant to be: the module, paths into it, its env
 *      keys, the /trust evidence sentence and the admin sponsor label.
 */

const ROOTS = ['app', 'components', 'lib', 'content', 'scripts'];
const EXTRA = ['proxy.ts', 'instrumentation.ts'];
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const BOUNDARY = 'lib/evidence-sui/';

function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (EXT.has(extname(name))) files.push(full.replaceAll('\\', '/'));
    }
  };
  for (const root of ROOTS) walk(root);
  for (const file of EXTRA) {
    try {
      if (statSync(file).isFile()) files.push(file);
    } catch {
      // optional entry point
    }
  }
  return files;
}

const MYSTEN_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"`](@mysten(?:-incubation)?\/[^'"`]+)['"`]/g;

test('only lib/evidence-sui imports a Mysten package, statically or dynamically', () => {
  const offenders = [];
  let insideBoundary = 0;
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(MYSTEN_IMPORT)) {
      if (file.startsWith(BOUNDARY)) insideBoundary++;
      else offenders.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, [], `@mysten imported outside ${BOUNDARY}`);
  assert.ok(insideBoundary > 0, 'the evidence layer itself still uses the Sui SDK (or this check is reading nothing)');
});

test('the import check catches every form it claims to', () => {
  const sample = [
    "import { X } from '@mysten/sui/utils';",
    "const m = await import('@mysten/seal');",
    "const r = require(\"@mysten/sui\");",
    "export { Y } from '@mysten-incubation/memwal';",
  ].join('\n');
  assert.equal([...sample.matchAll(MYSTEN_IMPORT)].length, 4);
});

test('the Sui settlement dependencies stay removed; the evidence ones stay', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const gone of ['@mysten/deepbook-v3', '@mysten/wallet-standard', '@mysten-incubation/memwal', '@kunalabs-io/sui-snap-wallet', '@shinami/clients', '@wallet-standard/app']) {
    assert.ok(!(gone in deps), `${gone} is a settlement-era dependency`);
  }
  for (const kept of ['@mysten/sui', '@mysten/seal']) assert.ok(kept in deps, `${kept} is the evidence layer`);
});

test('the ESLint rule names the boundary', () => {
  const config = readFileSync('eslint.config.mjs', 'utf8');
  assert.match(config, /"no-restricted-imports"/);
  assert.match(config, /"@mysten\/\*"/);
  assert.match(config, /ignores: \["lib\/evidence-sui\/\*\*", "tests\/\*\*"\]/);
});

/** Lines the §4.2 grep may match: the evidence layer and nothing else. */
const ALLOWED = [
  /lib\/evidence-sui\b|\.\/evidence-sui\/|\.\.\/evidence-sui\//, // the module and paths into it
  /\bEVIDENCE_|evidence sponsor|EVIDENCE_PRIVKEY|evidencePrivkey/i, // its env keys
  /Evidence on Sui|The only Sui the Solana build uses/, // the env.ts section header for those keys
  /'Sui sponsor \(evidence only\)'|Sui gas for allowlist updates only/, // the admin label (prompt 07 §7)
  /separate storage network that runs on Sui/, // the /trust evidence sentence
];
/**
 * Files that may name Sui outside the evidence layer: the crypto-wallet card's network list (prompt 10
 * §5.6, the one place a person picks a network), where Sui is shown as "Not available yet".
 */
const FILES_ALLOWED = new Set(['lib/solana-app/funding-router.ts']);
const P = /\bsui\b|zklogin|enoki|@mysten|suiscan|suivision|move::|AdminCap|packageId|suiprivkey|PTB|USDsui|deepbook|memwal/i;

test('the §4.2 grep finds Sui only in the evidence layer', () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    if (file.startsWith(BOUNDARY) || FILES_ALLOWED.has(file) || !/^(app|components|lib)\//.test(file)) continue;
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (P.test(line) && !ALLOWED.some((ok) => ok.test(line))) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [], 'Sui outside the evidence layer');
});
