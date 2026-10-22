// Prompt 07 §0.6 and §9: the words Splash never writes, checked in everything a person reads:
// app/**, components/**, content/** and README.md. Comments are engineering notes and are not read
// by customers, so they are stripped first. A negation ("not yet a licensed …", "no … guarantee")
// is the one way some of these words may appear.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

const ROOTS = ['app', 'components', 'content'];
/** Service files whose strings reach a screen (approval cards, route cards, funding and transfer copy). */
const SCREEN_LIB = ['lib/solana-app/service.ts', 'lib/solana-app/funding-service.ts', 'lib/solana-app/transfer-details.ts', 'lib/solana-app/source-of-funds.ts', 'lib/solana-app/treasury-service.ts', 'lib/solana-app/batch-service.ts', 'lib/solana-zeke/router.ts'];
const EXT = new Set(['.ts', '.tsx', '.mjs']);

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (EXT.has(extname(name))) out.push(full.replaceAll('\\', '/'));
  }
  return out;
}

/** Code without comments: what can reach a screen, an API answer or a page. */
function strip(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

const RULES = [
  { name: 'licensed', pattern: /\blicensed\b/i, allow: /\bnot[- ](?:yet[- ])?(?:an?[- ])?licensed\b|\bunlicensed\b|not-licensed/i },
  { name: 'gasless', pattern: /\bgasless\b/i },
  { name: 'free gas', pattern: /\bfree gas\b/i },
  { name: 'yield / APY', pattern: /\byield\b|\bAPY\b/i },
  { name: 'escrow', pattern: /\bescrow\b/i },
  { name: 'instant', pattern: /\binstant(?:ly)?\b/i },
  { name: 'guaranteed', pattern: /\bguarantee(?:d|s)?\b/i, allow: /\bno\b[^.]{0,40}\bguarantee\b/i },
  { name: 'autonomous', pattern: /\bautonomous\b/i },
  // A CSS duration (`[animation-delay:150ms]`, `duration-[300ms]`) is not a claim; a number of
  // milliseconds or seconds in a sentence is.
  { name: 'a speed or finality number', pattern: /(?<![:\-[\w])\d+(?:\.\d+)?\s?(?:ms|milliseconds?)\b|\bsub-second\b|\bin \d+\s?(?:seconds?|secs?)\b/i },
  // The payout partner is never named on a surface (GCash and Maya are the recipient's own wallets,
  // not partners, so they may be named).
  { name: 'a payout partner’s name', pattern: /\bPDAX\b|\bCoins\.ph\b/i },
  // An arrival promise is a speed claim even without a number.
  { name: 'an arrival time', pattern: /\bwithin (?:minutes|seconds|an hour)\b|\bsame (?:banking )?day\b|\bin minutes\b|\bin about \$?\{?\w*\}? hours?\b/i },
  // A speed ranking shown as a speed: the route the engine picks for least time is "the shortest route".
  { name: 'a speed ranking', pattern: /(?<![-_])\b(?:fastest|quickest)\b/i, allow: /\bfastest:\s|'fastest'|\.fastest\b|picks\.fastest|ranked\.fastest/ },
  // Prompt 10 §0.5, added in Phase 0 because the tree already passes them.
  { name: 'faster', pattern: /\bfaster\b/i },
  { name: 'earn / APR', pattern: /\b[Ee]arn(?:s|ing)?\b|\bAPR\b/ },
  { name: 'an SLA', pattern: /\bSLAs?\b/ },
  { name: 'Ondo as a partner', pattern: /\bpartner:?\s+Ondo\b|\bOndo\b[^.]{0,30}\bour partner\b|\bour partner\b[^.]{0,30}\bOndo\b/i },
];

function violations(path, text) {
  const out = [];
  strip(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const rule of RULES) {
        if (!rule.pattern.test(line)) continue;
        if (rule.allow && rule.allow.test(line)) continue;
        out.push(`${path}:${i + 1} [${rule.name}] ${line.trim().slice(0, 110)}`);
      }
    });
  return out;
}

test('no banned word on any surface a person reads (app, components, content, the service copy, README)', () => {
  const found = [];
  for (const root of ROOTS) for (const f of files(root)) found.push(...violations(f, readFileSync(f, 'utf8')));
  for (const f of SCREEN_LIB) found.push(...violations(f, readFileSync(f, 'utf8')));
  found.push(...violations('README.md', readFileSync('README.md', 'utf8')));
  assert.deepEqual(found, [], `\n  ${found.join('\n  ')}\n`);
});

test('the rules catch what they claim to, and let the negations through', () => {
  assert.equal(violations('x.tsx', "<p>Gasless payments, instantly.</p>").length, 2);
  assert.equal(violations('x.tsx', "<p>Settles in 400 ms</p>").length, 1);
  assert.equal(violations('x.tsx', '<span className="[animation-delay:150ms]" />').length, 0, 'a CSS duration is not a claim');
  assert.equal(violations('x.tsx', "<p>Paid by PDAX</p>").length, 1);
  assert.equal(violations('x.tsx', "words: 'Within minutes, InstaPay'").length, 1);
  assert.equal(violations('x.tsx', '<p>Same banking day, PESONet</p>').length, 1);
  assert.equal(violations('x.tsx', '<p>Fastest route</p>').length, 1, 'a speed ranking shown as a speed');
  assert.equal(violations('x.ts', "const best = r.picks.fastest; const k = 'fastest';").length, 0, 'the internal policy key is not copy');
  assert.equal(violations('x.ts', 'return `arrives in about ${hours} hours`;').length, 1);
  assert.equal(violations('x.tsx', "<p>An autonomous vault</p>").length, 1);
  assert.equal(violations('x.tsx', "<p>Splash is not yet a licensed money-services business.</p>").length, 0);
  assert.equal(violations('x.tsx', '<p>It carries no availability guarantee from anyone.</p>').length, 0);
  assert.equal(violations('x.tsx', '// an autonomous vault, in a comment').length, 0, 'comments are engineering notes');
  assert.equal(violations('x.tsx', '<p>Pay faster</p>').length, 1);
  assert.equal(violations('x.tsx', '<p>Earn 4% on idle cash</p>').length, 1);
  assert.equal(violations('x.tsx', '<p>5.2% APR</p>').length, 1);
  assert.equal(violations('x.tsx', "const MONTHS = ['Mar', 'Apr'];").length, 0, 'a month is not an APR');
  assert.equal(violations('x.tsx', '<p>Trust is earned</p>').length, 0, 'earned is not an offer to earn');
  assert.equal(violations('x.tsx', '<p>400ms settlement SLA</p>').length, 2);
  assert.equal(violations('x.tsx', '<p>Partner: Ondo</p>').length, 1);
  assert.equal(violations('x.tsx', '<p>USDY, issued by Ondo</p>').length, 0);
});

// Prompt 10 §5.9: words that are gone from the dashboard. The landing and the legacy surfaces the
// prompt leaves alone (§0.6's exclusion list) are other surfaces; the label maps in lib are not.
// The money-path panel and its content are rendered only by the legacy components/transfer/** flow
// (not routed), so they go with it.
const DASHBOARD_EXCLUDED = ['components/IsometricLanding.tsx', 'components/mobile/', 'components/landing/', 'app/page.tsx', 'app/admin/', 'components/oxwal/', 'components/funding/FundingSelector.tsx', 'components/transfer/', 'app/api/funding/', 'components/compliance/MoneyPathPanel.tsx', 'content/money-path.ts'];
const DASHBOARD_LIB = [...SCREEN_LIB, 'lib/solana-partner/registry.ts'];
const DASHBOARD_RULES = [
  { name: 'Via Polygon', pattern: /\bVia Polygon\b/i },
  { name: 'Shortest route', pattern: /\bShortest route\b/i },
  { name: 'Fewest steps', pattern: /\bFewest steps\b/i },
  { name: 'Stripe', pattern: /\bStripe\b/ },
  { name: 'Airwallex', pattern: /\bAirwallex\b/ },
  { name: 'Mock partner · devnet', pattern: /Mock partner\s*·\s*devnet/i },
];

function dashboardViolations(path, text) {
  const out = [];
  strip(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const rule of DASHBOARD_RULES) if (rule.pattern.test(line)) out.push(`${path}:${i + 1} [${rule.name}] ${line.trim().slice(0, 110)}`);
    });
  return out;
}

test('gone from the dashboard: Via Polygon, Shortest route, Fewest steps, Stripe, Airwallex, Mock partner · devnet', () => {
  const found = [];
  for (const root of ROOTS) {
    for (const f of files(root)) {
      if (DASHBOARD_EXCLUDED.some((x) => f === x || f.startsWith(x))) continue;
      found.push(...dashboardViolations(f, readFileSync(f, 'utf8')));
    }
  }
  for (const f of DASHBOARD_LIB) found.push(...dashboardViolations(f, readFileSync(f, 'utf8')));
  assert.deepEqual(found, [], `\n  ${found.join('\n  ')}\n`);
  // The rules themselves.
  assert.equal(dashboardViolations('x.tsx', "<span>Via Polygon</span><b>Shortest route</b>").length, 2, 'one entry per rule a line breaks');
  assert.equal(dashboardViolations('x.ts', "label: 'USD by card or bank, through Stripe'").length, 1);
  assert.equal(dashboardViolations('x.ts', "// Stripe stand-in, in a comment").length, 0, 'comments are engineering notes');
  assert.equal(dashboardViolations('x.ts', "const stripeId = 'x';").length, 0, 'a lower-case identifier is not the brand');
});

// The rules above read text; they cannot read a picture. These images carry a claim in their own
// pixels, so no screen may show them. They stay in public/ as prior work.
const BANNED_ART = [
  { file: 'isometric/payment-intent.svg', why: '"Atomic settlement on Sui", and invented balances' },
  { file: 'isometric/treasury.svg', why: '"Smart Treasury 4.8% APY": a yield' },
  { file: 'isometric/payments.svg', why: '"2 min 34 sec" (a speed number) and a 0.8% fee Splash does not charge' },
  { file: 'isometric/loop-save-v3.png', why: 'idle USD growing at a "variable" rate: a yield' },
  { file: 'isometric/loop-settle-v3.png', why: 'a "Minutes" clock: a speed claim (loop-settle-v4.png is the same art without it)' },
  { file: 'isometric/supply-settlement-v3.png', why: 'settlement on Sui' },
];

test('no screen shows an image whose own pixels make a banned claim', () => {
  const found = [];
  for (const root of ROOTS) {
    for (const f of [...files(root), ...filesWith(root, '.css')]) {
      const text = readFileSync(f, 'utf8');
      for (const art of BANNED_ART) if (text.includes(art.file)) found.push(`${f} shows ${art.file}: ${art.why}`);
    }
  }
  assert.deepEqual(found, [], `\n  ${found.join('\n  ')}\n`);
});

function filesWith(dir, ext) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesWith(full, ext));
    else if (extname(name) === ext) out.push(full.replaceAll('\\', '/'));
  }
  return out;
}
