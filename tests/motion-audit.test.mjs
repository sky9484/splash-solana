// Prompt 11 Phase 5, the motion audit: on the redesigned screens nothing moves on its own except the
// coins on a moving wire, the coin bob on the Invoices chooser, Treasury's live dot and ticking number,
// and the quote ring; and every movement has a reduced-motion state.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

const CSS = readFileSync('styles/iso-ui.css', 'utf8');

/** Each rule whose declarations loop forever, as [selector, declarations]. */
function loopingRules(css) {
  const out = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, decls] = m;
    if (!/animation(?:-iteration-count)?\s*:[^;]*\binfinite\b/.test(decls)) continue;
    for (const one of selector.split(',')) out.push([one.trim().replace(/\s+/g, ' '), decls.trim()]);
  }
  return out;
}

/** What may move on its own, and why. */
const ALLOWED = [
  { selector: '.iso .iso-wire--active line', why: 'a moving wire: money is moving' },
  { selector: '.iso .iso-wire--active .iso-coin', why: 'the coins on a moving wire' },
  { selector: '.iso .iso-mini__wire--active .iso-coin', why: 'the coins on the picked route’s line (a moving wire)' },
  { selector: '.iso .iso-tracker__bar--active .iso-coin', why: 'the coin on the tracker’s active segment (a moving wire)' },
  { selector: '.iso .iso-bob', why: 'the bob, used only by the Invoices chooser’s coins (checked below)' },
  { selector: '.iso .iso-chooser__art.iso-bob', why: 'the Invoices chooser’s coin bob, 5 px on 3.2 s' },
  { selector: '.iso .iso-livedot', why: 'Treasury’s live dot' },
];

/** Prompt 12 §0.6 and Phase 7: the landing (styles/landing-p12.css) may loop these by themselves, nothing else. */
const LANDING_CSS = readFileSync('styles/landing-p12.css', 'utf8');
const LANDING_ALLOWED = [
  { selector: '.lp-token', why: 'the USD and PHP tokens bobbing over the map on the hero’s first beat (§2.2)' },
  { selector: '.lp-bob', why: 'the Routes bridge, a gentle 6 s bob (§2.8)' },
  { selector: '.lp-cue__wheel::after', why: 'the wheel of the hero’s “Scroll to settle” mouse (Sky, 21 Oct, as on v1); gone with reduced motion, where nothing pins' },
];

/** Prompt 12 §3.2 and Phase 7: the loader (styles/auth-p12.css) bobs and pulses while something loads, nothing else there moves by itself. */
const AUTH_CSS = readFileSync('styles/auth-p12.css', 'utf8');
const AUTH_ALLOWED = [
  { selector: '.sl-drop', why: 'the loader’s droplet mark bobbing while the desk opens' },
  { selector: '.sl-token', why: 'the US dollar token bobbing beside the droplet' },
  { selector: '.sl-dots i', why: 'the loader’s three-dot pulse' },
];

function files(dir, exts) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name).replaceAll('\\', '/');
    if (statSync(full).isDirectory()) return files(full, exts);
    return exts.includes(extname(name)) ? [full] : [];
  });
}

test('nothing in the Iso styles loops on its own but the allowed movements', () => {
  const looping = loopingRules(CSS).map(([s]) => s);
  const unexpected = looping.filter((s) => !ALLOWED.some((a) => a.selector === s));
  assert.deepEqual(unexpected, [], `loops not on the list:\n  ${unexpected.join('\n  ')}`);
  // The list can't grow stale either.
  for (const a of ALLOWED) assert.ok(looping.includes(a.selector), `${a.selector} (${a.why}) no longer loops; take it off the list`);
});

test('nothing on the landing loops on its own but the hero tokens, the bridge and the scroll cue, and all stop with reduced motion', () => {
  const looping = loopingRules(LANDING_CSS).map(([s]) => s);
  const unexpected = looping.filter((s) => !LANDING_ALLOWED.some((a) => a.selector === s));
  assert.deepEqual(unexpected, [], `loops not on the list:\n  ${unexpected.join('\n  ')}`);
  for (const a of LANDING_ALLOWED) assert.ok(looping.includes(a.selector), `${a.selector} (${a.why}) no longer loops; take it off the list`);
  const body = LANDING_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const reduced = body.slice(body.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(reduced.length > 40, 'the landing has a reduced-motion block');
  assert.match(reduced, /\.lp-token,[\s\S]*?\.lp-bob,[\s\S]*?\.lp-cue__wheel::after,[\s\S]*?\{ animation: none; \}/, 'the tokens, the bridge and the cue stop');
  // The pinned story stops pinning: its beats stack as plain sections.
  assert.match(reduced, /\.lp-story__pin \{[^}]*position: static;/);
});

test('nothing on the sign-in pages, the loader, the 404 or the error page loops on its own but the loader, and it stops with reduced motion', () => {
  const looping = loopingRules(AUTH_CSS).map(([s]) => s);
  const unexpected = looping.filter((s) => !AUTH_ALLOWED.some((a) => a.selector === s));
  assert.deepEqual(unexpected, [], `loops not on the list:\n  ${unexpected.join('\n  ')}`);
  for (const a of AUTH_ALLOWED) assert.ok(looping.includes(a.selector), `${a.selector} (${a.why}) no longer loops; take it off the list`);
  const body = AUTH_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const reduced = body.slice(body.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.sl-drop,\s*\.sl-token,\s*\.sl-dots i \{ animation: none; \}/, 'the bob and the pulse stop');
  // The loader still waits 300 ms before it shows, so a quick load never flashes it.
  assert.match(body, /\.sl \{[^}]*animation: sl-show [^;]* 300ms both;/);
  assert.match(body, /@keyframes sl-show \{\s*from \{ opacity: 0; \}/);
});

test('the bob is the Invoices chooser’s only', () => {
  const users = [...files('components', ['.tsx']), ...files('app', ['.tsx'])].filter((f) => /\biso-bob\b/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(users, ['components/solana/invoices/InvoicesChooser.tsx']);
});

test('every movement has a reduced-motion state', () => {
  const reduced = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  // One rule caps every animation on the redesigned screens, their sheets and the approval moment.
  assert.match(reduced, /\.iso \*,\s*\.iso-sheet-root \*,\s*\.iso-modal-root \* \{[^}]*animation-iteration-count: 1 !important;[^}]*transition-duration: 0ms !important;/);
  // And each looping movement is stopped outright.
  for (const sel of ['.iso .iso-wire--active line', '.iso .iso-bob', '.iso .iso-wire--active .iso-coin', '.iso .iso-mini__wire--active .iso-coin', '.iso .iso-tracker__bar--active .iso-coin', '.iso .iso-livedot']) {
    assert.ok(reduced.includes(sel), `${sel} is stopped with reduced motion`);
  }
  // Boxes keep only their shadow change; the morph and the Transfer step entrance are cut.
  assert.match(reduced, /\.iso \.iso-surface:hover,[\s\S]*?transform: none !important;/);
  assert.match(reduced, /::view-transition-group\(\*\), ::view-transition-old\(\*\), ::view-transition-new\(\*\) \{ animation: none !important; \}/);
  assert.match(reduced, /\.iso \.iso-tx-enter \.iso-tx__step,/);
  // The live number moves once a minute instead of every second.
  assert.match(readFileSync('components/solana/treasury/TbillCard.tsx', 'utf8'), /prefers-reduced-motion: reduce\)'\)\.matches \? 60_000 : ms/);
});
