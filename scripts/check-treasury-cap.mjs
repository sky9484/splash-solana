#!/usr/bin/env node
/**
 * AdminCap cannot move money. This is the check that keeps it that way.
 *
 * Before Phase 6, one capability gated KYB verification, the compliance
 * config, guardian minting, every pause and unpause, every limit change, every
 * allowlist — and every withdrawal. Answering "who can move money?" meant
 * reading thirty-odd functions across three modules and concluding they all
 * could, which is the same answer as having no separation at all. It is also
 * the Step Finance shape: legitimate admin controls, compromised device, no
 * contract bug anywhere.
 *
 * The split only means something if it stays split, and the way it decays is
 * mundane — someone adds a withdrawal beside an existing `&AdminCap` function
 * because that is where the code already was. So the invariant is checked
 * mechanically:
 *
 *   In splash_custody, no function taking `&AdminCap` may split a balance.
 *
 * `balance::split` is the one idiom by which value leaves a custodial object in
 * this package — every `coin::from_balance` on a payout path is fed by one — so
 * a function that does not contain it cannot pay anything out. Deposits
 * (`balance::join`, `coin::into_balance`) are deliberately NOT restricted:
 * putting money in is not the risk.
 *
 * Run by `npm run lint`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES = ['move/splash_custody/sources', 'move/splash_core/sources'];

/** How value leaves a custodial balance. */
const VALUE_OUT = ['balance::split', 'coin::take'];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/\/\/.*$/, '')))
    .join('\n');
}

function functions(source) {
  const code = stripComments(source);
  const out = [];
  const signature = /\b(?:public(?:\([a-z]+\))?\s+)?fun\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g;
  let match;
  while ((match = signature.exec(code)) !== null) {
    let i = match.index + match[0].length - 1;
    let depth = 0;
    let paramsEnd = i;
    for (; i < code.length; i += 1) {
      if (code[i] === '(') depth += 1;
      else if (code[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          paramsEnd = i;
          break;
        }
      }
    }
    const params = code.slice(match.index + match[0].length, paramsEnd);

    const braceStart = code.indexOf('{', paramsEnd);
    let body = '';
    if (braceStart !== -1) {
      let d = 0;
      for (let j = braceStart; j < code.length; j += 1) {
        if (code[j] === '{') d += 1;
        else if (code[j] === '}') {
          d -= 1;
          if (d === 0) {
            body = code.slice(braceStart, j + 1);
            break;
          }
        }
      }
    }
    out.push({ name: match[1], params, body });
  }
  return out;
}

const failures = [];
let adminGated = 0;
let treasuryGated = 0;

for (const dir of PACKAGES) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.move'));
  } catch {
    failures.push(`${dir}: not readable — this check cannot verify what it claims to.`);
    continue;
  }

  for (const file of files) {
    const path = join(dir, file);
    const source = readFileSync(path, 'utf8');

    for (const fn of functions(source)) {
      const takesAdmin = /&\s*AdminCap\b/.test(fn.params);
      const takesTreasury = /&\s*TreasuryCap\b/.test(fn.params);
      if (takesAdmin) adminGated += 1;
      if (takesTreasury) treasuryGated += 1;

      if (!takesAdmin) continue;
      const found = VALUE_OUT.filter((idiom) => fn.body.includes(idiom));
      if (found.length > 0) {
        failures.push(
          `${path}: \`${fn.name}\` takes \`&AdminCap\` and calls ${found.join(', ')}.\n` +
            `    AdminCap governs; it does not spend. Gate this on \`&TreasuryCap\` — the\n` +
            `    cold 2-of-3 — or move the payout into a function that is.`,
        );
      }
    }
  }
}

// splash_core holds no value at all (check:core proves that separately), so a
// TreasuryCap function there would be meaningless. The count that matters is
// custody's, and if it drops to zero the split has been undone rather than
// improved.
if (treasuryGated === 0) {
  failures.push(
    'No function takes `&TreasuryCap`. Either the money capability was removed — in\n' +
      '    which case delete this check deliberately — or every withdrawal has drifted\n' +
      '    back onto another cap.',
  );
}

if (failures.length > 0) {
  console.error('AdminCap must not be able to move money. These break that:\n');
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

console.log(
  `Money authority is split: ${treasuryGated} function(s) on TreasuryCap, ` +
    `${adminGated} on AdminCap, none of which can split a balance.`,
);
