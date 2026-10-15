// Prompt 10 §2.1: every text/fill pair in look 9 passes 4.5:1, computed from styles/tokens.css itself
// (so a token change that breaks contrast fails here), plus the lint that keeps redesigned files on
// those tokens (scripts/check-iso-ui.mjs) and the dev-only style sheet's production guard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { findings, tokenColours } from '../scripts/check-iso-ui.mjs';

const css = readFileSync('styles/tokens.css', 'utf8');
const block = css.slice(css.indexOf('\n.iso {'), css.indexOf('\n}', css.indexOf('\n.iso {')));
const token = (name) => {
  const m = new RegExp(`--${name}:\s*([^;]+);`).exec(block);
  assert.ok(m, `token --${name} is in the .iso block`);
  return m[1].trim();
};

function rgba(v) {
  const s = v.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[/,]\s*([\d.]+))?/.exec(s);
  assert.ok(m, `a colour: ${s}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}
/** A colour with alpha, laid over an opaque background. */
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const lum = ({ r, g, b }) => {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export function ratio(fg, bg) {
  const b = rgba(bg);
  const f = over(rgba(fg), b);
  const [l1, l2] = [lum(f), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const PAIRS = [
  ['ink', 'paper'], ['ink-deep', 'paper'], ['ink', 'ground'], ['ink-deep', 'white'],
  ['text-2', 'paper'], ['text-2', 'ground'], ['text-2', 'white'],
  // Prompt 11 §1.2: every box's near-white fill, and the pay page's kept ground.
  ['ink', 'surface'], ['ink-deep', 'surface'], ['text-2', 'surface'], ['teal', 'surface'],
  ['ink', 'ground-grid'], ['text-2', 'ground-grid'],
  // The hero wash: every text pair on its mint start too (decision 20).
  ['ink', 'mint-wash'], ['ink-deep', 'mint-wash'], ['text-2', 'mint-wash'], ['teal', 'mint-wash'],
  ['teal', 'paper'], ['teal', 'white'],
  ['paper-warm', 'teal'],          // primary button
  ['ink-deep', 'coral'],           // approve button: ink on coral, never white
  ['ink-deep', 'gold'],            // Test mode badge, coins
  ['ink-deep', 'mint'],            // the chosen road, mint chips
  ['amber-ink', 'amber-fill'],     // warnings
  ['ok-ink', 'ok-fill'],           // covered, verified
  ['coral-ink', 'coral-fill'],     // the Approve tag
  ['danger-ink', 'danger-fill'],   // failures
  ['gold-ink', 'gold-fill'],       // the investments ribbon
  ['paper-warm', 'ink-deep'],      // the ink action bar, Zeke strip
  ['mint', 'ink-deep'],            // links on the ink strip
];

test('every look 9 text/fill pair passes 4.5:1, computed from the token file', () => {
  const failing = [];
  for (const [fg, bg] of PAIRS) {
    const r = ratio(token(fg), token(bg));
    if (r < 4.5) failing.push(`--${fg} on --${bg}: ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(failing, []);
});

test('the sidebar: its text and group labels pass on the lightest end of the gradient', () => {
  const top = '#245563';
  assert.ok(ratio(token('side-text'), top) >= 4.5, 'item text at 86% white');
  assert.ok(ratio(token('side-label'), top) >= 4.5, 'group labels at 72% white (64% fails here)');
  assert.ok(ratio('rgb(255 250 241 / .64)', top) < 4.5, 'the old 64% really fails, which is why it is 72%');
});

test('amber #B4690E is for icons and borders only: it fails 4.5:1 as text, as §2.1 says', () => {
  assert.ok(ratio(token('amber-mark'), token('amber-fill')) < 4.5);
  assert.ok(ratio(token('muted'), token('paper')) < 4.5, 'muted is for non-text only');
});

test('check-iso-ui catches blurred shadows, native selects, stray colours and a second extruded number', () => {
  const colours = tokenColours();
  const f = (src, name = 'components/x/Y.tsx') => findings(name, src, colours);
  assert.equal(f('<div style={{ boxShadow: "3px 3px 0 #083640" }} />').length, 0, 'a solid ledge is fine');
  assert.equal(f('<div style={{ boxShadow: "0 12px 32px #083640" }} />').length, 1, 'a blur is not');
  assert.equal(f('<div className="rounded shadow-lg" />').length, 1);
  assert.equal(f('<select name="x"></select>').length, 1);
  assert.equal(f('<div style={{ color: "#123456" }} />').length, 1);
  assert.equal(f('<div style={{ color: "#0C3E48", background: "rgb(12 62 72 / .2)" }} />').length, 0);
  assert.equal(f('<a href="#settings">x</a>').length, 0, 'an anchor is not a colour');
  assert.equal(f('<IsoDisplay>a</IsoDisplay><IsoDisplay>b</IsoDisplay>').length, 1);
  assert.equal(f('// iso-ui states: 2\n<IsoDisplay>a</IsoDisplay><IsoDisplay>b</IsoDisplay>').length, 0);
  assert.equal(f('.a { box-shadow: 0 1px 2px rgb(12 62 72 / .2); }', 'styles/z.css').length, 1);
  assert.equal(f('.a { box-shadow: var(--ledge-1); }', 'styles/z.css').length, 0);
  // Prompt 11 §1.1: a box floats on a --lift-* token; the same shadow written out is still caught.
  assert.equal(f('.a { box-shadow: var(--lift-1); }', 'styles/z.css').length, 0);
  assert.equal(f('.a { box-shadow: 0 10px 24px -12px rgb(8 54 64 / .26); }', 'styles/z.css').length, 1);
});

test('prompt 11 §1.1 (Sky, 15 Oct): the landing’s warm paper with no grid, the box fill and edge, and the four lift shadows', () => {
  assert.equal(token('ground'), '#ECE5D8'); // sand (Sky, 16 Oct)
  assert.equal(token('surface'), '#FFFDFA');
  assert.equal(token('surface-line'), 'rgb(12 62 72 / .09)');
  assert.equal(token('lift-1'), '0 1px 2px rgb(8 54 64 / .06), 0 10px 24px -12px rgb(8 54 64 / .26)');
  assert.equal(token('lift-2'), '0 2px 4px rgb(8 54 64 / .07), 0 22px 40px -14px rgb(8 54 64 / .34)');
  assert.equal(token('lift-hero'), '0 2px 4px rgb(8 54 64 / .07), 0 18px 38px -16px rgb(8 54 64 / .34)');
  assert.equal(token('lift-hero-2'), '0 3px 6px rgb(8 54 64 / .08), 0 28px 52px -18px rgb(8 54 64 / .42)');
  assert.equal(token('rise'), '-3px');
  assert.equal(token('rise-chooser'), '-5px');
  assert.equal(token('t-lift'), '220ms cubic-bezier(.2, .7, .2, 1)');
  const ui = readFileSync('styles/iso-ui.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // No grid on the dashboard: the shell's page and every box are flat paper; only the pay page keeps it.
  const rule = (sel) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(ui)?.[1] ?? '';
  for (const sel of ['.iso-app .iso-main', '.iso .iso-surface--hero', '.iso .iso-surface']) {
    assert.ok(rule(sel), `${sel} is in styles/iso-ui.css`);
    assert.doesNotMatch(rule(sel), /--grid|linear-gradient\(rgb|background-size: 24px/, `${sel} draws no grid`);
  }
  assert.match(rule('.iso.iso-paypage'), /var\(--grid\)/, 'the pay page keeps its grid');
  assert.match(rule('.iso .iso-surface'), /box-shadow: var\(--lift-1\)/);
  assert.match(rule('.iso .iso-surface--hero'), /box-shadow: var\(--lift-hero\)/);
  // Hover only under a fine pointer, and never a lift with reduced motion.
  assert.match(ui, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.iso \.iso-surface:hover,\s*\.iso \.iso-surface:focus-within \{ transform: translateY\(var\(--rise\)\); \}/);
  assert.match(ui, /prefers-reduced-motion: reduce[\s\S]*\.iso \.iso-surface:hover,[\s\S]*transform: none !important;/);
  // A finished rise holds no transform, or the hover lift would never show.
  assert.match(ui, /\.iso \.iso-rise \{ animation: iso-rise \.5s var\(--ease-iso\) backwards; \}/);
});

test('prompt 11 decision 3: the screens outside .iso float on the same lift, with no drift', () => {
  const start = css.indexOf('\n.iso-app {');
  assert.ok(start > 0, 'the shell carries the lift tokens (.iso-app in styles/tokens.css)');
  const shell = css.slice(start, css.indexOf('\n}', start));
  for (const name of ['lift-1', 'lift-2', 'rise', 't-lift']) {
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(shell);
    assert.ok(m, `--${name} is on .iso-app`);
    assert.equal(m[1].trim(), token(name), `--${name} on .iso-app equals the .iso block`);
  }
  const ui = readFileSync('styles/iso-ui.css', 'utf8');
  assert.match(ui, /\.iso-app \.iso-main :is\(\.sx-card, \.dash-surface, \.dash-block\) \{\s*box-shadow: var\(--lift-1\);/);
});

test('prompt 11 §1.3: buttons are 40 px, the main action 48 px', () => {
  const ui = readFileSync('styles/iso-ui.css', 'utf8');
  assert.match(ui, /\.iso \.iso-btn \{[^}]*min-height: 40px;/);
  assert.match(ui, /\.iso \.iso-btn--lg \{ min-height: 48px;/);
});

test('no Iso UI class shares a name with the landing CSS, so neither leaks into the other', () => {
  // Rules only: a comment may name a class to explain why it isn't used.
  const classes = (file) => new Set([...readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(iso-[a-z0-9_-]+)/g)].map((m) => m[1]));
  const mine = classes('styles/iso-ui.css');
  const clash = [];
  for (const file of ['app/globals.css', 'styles/cinematic.css', 'styles/landing.css', 'styles/mobile-landing.css']) {
    for (const c of classes(file)) if (mine.has(c)) clash.push(`${c} (also in ${file})`);
  }
  assert.deepEqual(clash, []);
});

test('the living style sheet is dev only: production answers 404', () => {
  const page = readFileSync('app/dashboard/concept/page.tsx', 'utf8');
  assert.match(page, /if \(process\.env\.NODE_ENV === 'production'\) notFound\(\);/);
  assert.match(page, /import \{ notFound \} from 'next\/navigation';/);
  // Not in the sidebar.
  assert.doesNotMatch(readFileSync('components/dashboard/DashboardShell.tsx', 'utf8'), /\/dashboard\/concept/);
});
