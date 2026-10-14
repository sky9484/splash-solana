// Prompt 11 Phase 1, checked in a real browser: warm paper with no grid, every page box lifted on a
// soft shadow that rises 3 px under a real mouse and settles back (and nothing beside it moves), no
// movement with reduced motion or on a touch screen, buttons at 40 / 48 px, and axe's colour-contrast
// rule on every page at both widths.
//
// Run it against a dev server whose database tests/solana-ui.e2e.mjs has walked (pages have content):
//   BASE_URL=http://localhost:3200 node --test tests/p9-surfaces.e2e.mjs
// It needs a Chrome that has a mouse: a headless Chrome on a server reports (hover: none) and fails
// fast. On a server, run a headful Chrome on a virtual display (Xvfb) through CHROME_PATH.
// AXE_ONLY=1 records axe alone (for the screens before prompt 11, which have no lift to check).
// Writes its evidence to OUT (default docs/design/p9/evidence), as <LABEL>-surfaces.json.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { findChrome, launch } from './helpers/cdp-browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.OUT ?? 'docs/design/p9/evidence';
const LABEL = process.env.LABEL ?? 'after';
const AXE_ONLY = process.env.AXE_ONLY === '1';
const DEMO_PASSWORD = /const DEMO_PASSWORD = '([^']+)'/.exec(readFileSync('scripts/dev-db.mjs', 'utf8'))?.[1];
const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const DESKTOP = [1440, 900];
const PHONE = [390, 844];

const PAGES = [
  ['Overview', '/dashboard'],
  ['Balance', '/dashboard/fund'],
  ['Treasury', '/dashboard/treasury'],
  ['Invoices', '/dashboard/invoices'],
  ['Pay an invoice', '/dashboard/invoices/pay'],
  ['Get paid', '/dashboard/invoices/get'],
  ['Transfer', '/dashboard/transfer'],
  ['Zeke', '/dashboard/zeke'],
  ['History', '/dashboard/history'],
  ['Recipients', '/dashboard/recipients'],
  ['Rules', '/dashboard/settings/policy'],
  ['Settings', '/dashboard/settings'],
];

/** The page's own boxes: not inside another box, a sheet, a dialog or the floating Zeke. */
// The screens not yet rebuilt in look 9 (History, Recipients, Rules, Settings) use .sx-card, .dash-surface, .dash-block.
// A box that must stay put (--still: Transfer's intent header and its sticky So far) is not hovered.
const BOXES = `[...document.querySelectorAll('main .iso-surface, main .iso-ticket, main .iso-chooser__card, main .sx-card, main .dash-surface, main .dash-block')].filter((el) => el.getClientRects().length > 0 && !el.classList.contains('iso-surface--still') && !el.parentElement.closest('.iso-surface, .iso-ticket, .iso-chooser__card, .sx-card, .dash-surface, .dash-block, .iso-sheet-root, .iso-modal-root, .iso-zk'))`;

async function axe(page) {
  const has = await page.evaluate(() => typeof window.axe === 'object');
  if (!has) await page.evaluate((src) => { (0, eval)(src); }, AXE);
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations'] });
    return r.violations.flatMap((v) => v.nodes.map((n) => ({ target: n.target.join(' '), summary: n.any.map((a) => a.message).join('; ') })));
  });
}

/** Hover one box with a real mouse: its lift, and whether anything beside it moved. */
async function hover(page, i) {
  const at = await page.evaluate((src, idx) => {
    const box = eval(src)[idx];
    box.scrollIntoView({ block: 'center' });
    const r = box.getBoundingClientRect();
    // A point inside the box that is the box (or its own content), not something laid over it.
    const xs = [r.left + 12, r.left + r.width / 2, r.right - 12];
    // Only the part on screen: a box taller than the phone's window runs off both edges.
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, window.innerHeight);
    const ys = [top + 12, top + Math.min((bottom - top) / 2, 60), bottom - 12];
    for (const y of ys) for (const x of xs) {
      const hit = document.elementFromPoint(x, y);
      // Not a control inside the box (a chooser card is itself a link: that is fine).
      const control = hit?.closest('input, textarea, button, a, [role=combobox]');
      if (hit && box.contains(hit) && (!control || control === box || !box.contains(control))) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  }, BOXES, i);
  if (!at) return null;
  const measure = (k) =>
    page.evaluate((src, idx) => {
      const box = eval(src)[idx];
      const cs = getComputedStyle(box);
      const next = box.nextElementSibling ?? box.parentElement.nextElementSibling;
      const nr = next ? next.getBoundingClientRect() : null;
      const name = (box.getAttribute('aria-label') ?? box.querySelector('h1, h2, h3')?.textContent ?? box.className).trim().slice(0, 60);
      return { name, transform: cs.transform, shadow: cs.boxShadow, next: nr ? [nr.top, nr.left, nr.width, nr.height].map(Math.round) : null, scrollH: document.documentElement.scrollHeight };
    }, BOXES, k);
  await page.mouse(4, 4);
  await page.sleep(350);
  const rest = await measure(i);
  await page.mouse(at.x, at.y);
  await page.sleep(400);
  const up = await measure(i);
  await page.mouse(4, 4);
  await page.sleep(400);
  const back = await measure(i);
  const ty = (t) => (t === 'none' ? 0 : Number(/matrix\(([^)]+)\)/.exec(t)?.[1].split(',')[5] ?? NaN));
  return { name: rest.name, restY: ty(rest.transform), hoverY: ty(up.transform), backY: ty(back.transform), shadowChanged: rest.shadow !== up.shadow, nextMoved: JSON.stringify(rest.next) !== JSON.stringify(up.next), heightMoved: rest.scrollH !== up.scrollH, restShadow: rest.shadow };
}

/** The first box with a free spot to point at (a box full of links or fields has none). */
async function firstHover(page, count) {
  for (let i = 0; i < count; i++) {
    const h = await hover(page, i);
    if (h) return h;
  }
  return null;
}

async function run(page) {
  const evidence = { label: LABEL, base: BASE, at: new Date().toISOString(), ground: null, pages: [] };
  await page.goto(`${BASE}/login`);
  await page.fill('Business email', 'demo@acme.test');
  await page.fill('Password', DEMO_PASSWORD);
  await page.click('button', 'Sign in', { exact: true });
  await page.waitFor(() => location.pathname.startsWith('/dashboard'), [], { what: 'the dashboard after sign-in' });

  for (const [name, url] of PAGES) {
    await page.setViewport(...DESKTOP);
    await page.emulateMedia([]);
    await page.goto(`${BASE}${url}`);
    await page.waitIdle();
    await page.sleep(1200);
    const entry = { name, url, axe: { 1440: await axe(page) } };
    if (!AXE_ONLY) {
      const paint = await page.evaluate(() => {
        const main = document.querySelector('main');
        const cs = getComputedStyle(main);
        return { background: cs.backgroundColor, image: cs.backgroundImage };
      });
      entry.ground = paint;
      const count = await page.evaluate((src) => eval(src).length, BOXES);
      entry.boxes = [];
      for (let i = 0; i < Math.min(count, 6); i++) {
        const h = await hover(page, i);
        if (h) entry.boxes.push(h);
      }
      // Reduced motion: the shadow may change, the box never moves.
      await page.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      entry.reduced = await firstHover(page, count);
      await page.emulateMedia([]);
      // Every button: 40 px, the main action 48 px (link-style buttons and small row buttons aside).
      entry.buttons = await page.evaluate(() =>
        [...document.querySelectorAll('main .iso-btn')].filter((b) => b.getClientRects().length > 0).map((b) => ({ text: b.innerText.trim().slice(0, 40), kind: b.classList.contains('iso-btn--link') ? 'link' : b.classList.contains('iso-btn--lg') ? 'lg' : b.classList.contains('iso-btn--sm') ? 'sm' : 'md', h: Math.round(b.getBoundingClientRect().height) })),
      );
    }
    // A phone: a touch screen. Nothing rises under a finger.
    await page.setViewport(...PHONE);
    await page.sleep(600);
    entry.axe[390] = await axe(page);
    if (!AXE_ONLY) {
      entry.touch = await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
      const count = await page.evaluate((src) => eval(src).length, BOXES);
      entry.touchHover = await firstHover(page, count);
      entry.overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    }
    evidence.pages.push(entry);
    console.log(`[surfaces] ${name}: ${entry.boxes?.length ?? 0} boxes, axe ${entry.axe[1440].length} + ${entry.axe[390].length}`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${LABEL}-surfaces.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const skip = (!findChrome() && 'no Chrome, Edge or Chromium found (set CHROME_PATH)') || (!DEMO_PASSWORD && 'no seeded demo password in scripts/dev-db.mjs');

test('prompt 11 Phase 1: warm paper, floating boxes that rise 3 px and settle, 40 / 48 px buttons, contrast', { skip, timeout: 900_000 }, async () => {
  const browser = await launch();
  let ev;
  try {
    const page = await browser.newPage({ width: DESKTOP[0], height: DESKTOP[1] });
    // A headless Chrome on a server has no mouse: it reports (hover: none), so no box could rise. Run
    // this in a desktop Chrome, or a headful one on a virtual display (Xvfb, through CHROME_PATH).
    const mouseHere = await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
    assert.ok(AXE_ONLY || mouseHere, 'this Chrome reports no mouse (hover: none), so hover cannot be checked here');
    ev = await run(page);
  } finally {
    await browser.close();
  }
  if (AXE_ONLY) return;
  const problems = [];
  for (const p of ev.pages) {
    if (p.ground.background !== 'rgb(244, 238, 233)' || p.ground.image !== 'none') problems.push(`${p.name}: the page is ${p.ground.background} ${p.ground.image}`);
    if (p.boxes.length === 0) problems.push(`${p.name}: no page box was found to hover`);
    for (const b of p.boxes) {
      if (b.restY !== 0 || b.backY !== 0) problems.push(`${p.name} / ${b.name}: not at rest before or after (${b.restY}, ${b.backY})`);
      if (b.hoverY !== -3 && b.hoverY !== -5) problems.push(`${p.name} / ${b.name}: rose ${b.hoverY} px on hover`);
      if (!b.shadowChanged) problems.push(`${p.name} / ${b.name}: its shadow didn't deepen on hover`);
      if (b.nextMoved || b.heightMoved) problems.push(`${p.name} / ${b.name}: something beside it moved`);
      if (b.restShadow === 'none') problems.push(`${p.name} / ${b.name}: no shadow at rest`);
    }
    if (p.boxes.length && !p.reduced) problems.push(`${p.name}: reduced motion was not checked (no box to point at)`);
    if (p.reduced && p.reduced.hoverY !== 0) problems.push(`${p.name}: moved ${p.reduced.hoverY} px with reduced motion`);
    if (p.boxes.length && !p.touchHover) problems.push(`${p.name}: touch was not checked (no box to point at)`);
    if (p.touch) problems.push(`${p.name}: a phone matched (hover: hover) and (pointer: fine)`);
    if (p.touchHover && p.touchHover.hoverY !== 0) problems.push(`${p.name}: moved ${p.touchHover.hoverY} px on a touch screen`);
    if (p.overflow > 0) problems.push(`${p.name}: ${p.overflow}px sideways scroll at 390 px`);
    for (const b of p.buttons) {
      const want = { md: 40, lg: 48, sm: 36, link: 44 }[b.kind];
      if (b.h < want || (b.kind !== 'link' && b.h > want + 4)) problems.push(`${p.name}: "${b.text}" (${b.kind}) is ${b.h} px, not ${want}`);
    }
  }
  assert.deepEqual(problems, []);
});
