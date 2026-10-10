/**
 * Every environment variable the application reads must be declared in
 * lib/env.ts. This is the check that makes that a build failure rather than
 * a convention — the same posture as check:core for the non-custody
 * invariant.
 *
 * Why it looks at four patterns. The first audit of this repo grepped for
 * `process.env.X` and found 111 keys. The real number was 147: seal-config.ts
 * reads through an aliased `env.X`; contract-config.ts reads
 * `process.env[FIELD_TO_ENV[field]]` with the names in a lookup table;
 * zklogin.ts builds the key from a string literal and indexes with it; and
 * funding/registry.ts passes the key to a helper, `envFlag(env, 'KEY', …)`.
 * A guard that saw only the first pattern declared the repo clean while
 * Seal — the subsystem that actually broke between two machines — went
 * unvalidated. The first draft of this script found two more keys three
 * greps had missed.
 *
 * Per file under app/, lib/ and components/:
 *   1. `process.env.KEY`                                       direct
 *   2. `env.KEY`, where the file binds env to ProcessEnv         aliased
 *   3. `fn(env, 'KEY', …)` or `fn(process.env, 'KEY', …)`        helper
 *   4. a 'KEY' value inside an object literal whose name         table
 *      contains ENV (FIELD_TO_ENV and the like)
 *   5. `env['KEY']`, or `const k = … 'KEY' …` followed by         index
 *      `env[k]` in the same file
 *   6. `env[`PREFIX_${…}`]` / `process.env[`PREFIX_${…}`]`       dynamic
 *
 * A bare UPPER_SNAKE literal that is none of those — a type-union member, a
 * mock value, an enum — is not a key and is not flagged.
 *
 * Every key found must be in ENV_KEYS, or start with an ENV_KEY_PREFIXES
 * entry. NODE_ENV and NEXT_RUNTIME belong to Node and Next.
 *
 * Run: node --experimental-strip-types scripts/check-env-reads.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import { ENV_KEYS, ENV_KEY_PREFIXES } from '../lib/env.ts';

const ROOTS = ['app', 'lib', 'components'];
const EXT = new Set(['.ts', '.tsx', '.mjs', '.js']);
const RUNTIME_OWNED = new Set(['NODE_ENV', 'NEXT_RUNTIME']);
const SELF = 'lib/env.ts';
const KEY = '[A-Z][A-Z0-9_]*';

const declared = new Set(ENV_KEYS);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (EXT.has(extname(name))) yield full;
  }
}

/** @returns {Map<string, string[]>} key (or PREFIX_*) -> ["file:line", ...] */
function collect() {
  const found = new Map();
  const note = (key, file, line) => {
    if (RUNTIME_OWNED.has(key)) return;
    if (!found.has(key)) found.set(key, []);
    found.get(key).push(`${file}:${line}`);
  };

  for (const root of ROOTS) {
    for (const full of files(root)) {
      const file = relative(process.cwd(), full).replaceAll('\\', '/');
      if (file === SELF) continue;
      const text = readFileSync(full, 'utf8');
      const lines = text.split(/\r?\n/);

      const aliasesEnv = /\benv\s*(?::|=)\s*(?:NodeJS\.)?ProcessEnv\b|\benv\s*=\s*process\.env\b/.test(text);

      // 5, two-step: identifiers that are later used as env[ident].
      const indexedIdents = new Set();
      for (const m of text.matchAll(/(?:process\.env|\benv)\s*\[\s*([A-Za-z_$][\w$]*)\s*\]/g)) indexedIdents.add(m[1]);

      // 4: object literals whose identifier mentions ENV. Track brace depth
      // from the declaring line to its close.
      let inEnvTable = 0;

      lines.forEach((line, i) => {
        const n = i + 1;

        for (const m of line.matchAll(new RegExp(`process\\.env\\.(${KEY})`, 'g'))) note(m[1], file, n);
        if (aliasesEnv) for (const m of line.matchAll(new RegExp(`\\benv\\.(${KEY})`, 'g'))) note(m[1], file, n);

        for (const m of line.matchAll(new RegExp(`\\b[A-Za-z_$][\\w$]*\\(\\s*(?:process\\.env|env)\\s*,\\s*['"](${KEY})['"]`, 'g'))) note(m[1], file, n);

        for (const m of line.matchAll(new RegExp(`(?:process\\.env|\\benv)\\s*\\[\\s*['"](${KEY})['"]\\s*\\]`, 'g'))) note(m[1], file, n);
        for (const ident of indexedIdents) {
          const decl = new RegExp(`\\b(?:const|let|var)\\s+${ident}\\b[^;]*?['"](${KEY})['"]`, 'g');
          for (const m of line.matchAll(decl)) note(m[1], file, n);
          // ternary / alternate literal on the same declaration line
          if (decl.test(line)) for (const m of line.matchAll(new RegExp(`['"](${KEY})['"]`, 'g'))) note(m[1], file, n);
        }

        for (const m of line.matchAll(new RegExp(`(?:process\\.env|\\benv)\\s*\\[\\s*\`(${KEY}_)\\$\\{`, 'g'))) note(m[1] + '*', file, n);

        if (inEnvTable === 0 && /\b[A-Za-z_$]*ENV[A-Za-z_$]*\s*(?::[^=]+)?=\s*\{/.test(line)) inEnvTable = 1;
        if (inEnvTable > 0) {
          for (const m of line.matchAll(new RegExp(`:\\s*['"](${KEY})['"]`, 'g'))) note(m[1], file, n);
          const opens = (line.match(/\{/g) ?? []).length;
          const closes = (line.match(/\}/g) ?? []).length;
          inEnvTable += opens - closes - (inEnvTable === 1 && opens > 0 ? 1 : 0);
          if (inEnvTable <= 0) inEnvTable = 0;
          else if (closes > 0 && opens === 0 && inEnvTable === 1) inEnvTable = 0;
        }
      });
    }
  }
  return found;
}

const found = collect();
const undeclared = [];

for (const [key, sites] of found) {
  if (key.endsWith('*')) {
    if (!ENV_KEY_PREFIXES.includes(key.slice(0, -1))) undeclared.push([key, sites]);
    continue;
  }
  if (declared.has(key)) continue;
  if (ENV_KEY_PREFIXES.some((p) => key.startsWith(p))) continue;
  undeclared.push([key, sites]);
}

const read = [...found.keys()].filter((k) => !k.endsWith('*')).length;

if (undeclared.length) {
  console.error(`Environment reads not declared in lib/env.ts (${undeclared.length}):\n`);
  for (const [key, sites] of undeclared.sort()) {
    console.error(`  ${key}`);
    for (const s of sites.slice(0, 4)) console.error(`      ${s}`);
    if (sites.length > 4) console.error(`      … and ${sites.length - 4} more`);
  }
  console.error('\nAdd each key to the schema in lib/env.ts in the same commit that reads it.');
  process.exit(1);
}

console.log(`Environment contract holds: ${read} distinct keys read, ${declared.size} declared.`);
