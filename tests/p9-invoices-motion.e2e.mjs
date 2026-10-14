// Prompt 11 Phase 3, checked in Chrome: the Invoices chooser's two cards rise in 70 ms apart and their
// coins bob 5 px on a 3.2 s loop; the chosen card grows into the hero of the page it opens through a
// named view transition (420 ms, cubic-bezier(.2,.7,.2,1)) while the rest of the page, the other card
// with it, fades over the same 420 ms; where view transitions can't run, the card lifts to 1.03 for
// 320 ms and then navigates; with reduced motion it navigates at once; Enter on a focused card does the
// same; the "Invoices" breadcrumb morphs back.
//
//   BASE_URL=http://localhost:3200 node --test tests/p9-invoices-motion.e2e.mjs
//   BASE_URL=http://localhost:3300 PROD=1 node --test tests/p9-invoices-motion.e2e.mjs   (next start)
//
// A morph plays only when the page it opens renders in the same commit as the navigation, which needs
// that page's content cached (Next's view-transitions guide). The cards and the breadcrumb prefetch
// their whole page, but Next prefetches only in production. So against `next dev` the test first
// visits each page once by a client navigation; with PROD=1 (a production server) it doesn't, and the
// very first click must morph. Moving between pages uses client navigation (the breadcrumb): a full
// reload empties Next's client cache.
//
// On a fresh database it sets the demo company up first (the dashboard asks for that).
// FRAMES=<dir> also writes the screencast frames of each motion there (for the GIFs in the PR).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { findChrome, launch } from './helpers/cdp-browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const PROD = process.env.PROD === '1';
const FRAMES = process.env.FRAMES ?? null;
const DEMO_PASSWORD = /const DEMO_PASSWORD = '([^']+)'/.exec(readFileSync('scripts/dev-db.mjs', 'utf8'))?.[1];
const CHOOSER = '/dashboard/invoices';

/**
 * Puts `window.__vt()` in the page: every view-transition animation running now, its pseudo-element,
 * CSS animation name, duration and easing. A CSS animation's timing function sits on its keyframes (the
 * effect's own easing is linear). Defined through the debugging protocol, not `eval`: the production
 * pages' Content-Security-Policy refuses eval.
 */
const installProbe = (page) =>
  page.evaluate(() => {
    window.__vt = () =>
      document
        .getAnimations()
        .filter((a) => /::view-transition/.test(a.effect?.pseudoElement ?? ''))
        .map((a) => ({ pseudo: a.effect.pseudoElement, name: a.animationName ?? '', duration: a.effect.getTiming().duration, easing: a.effect.getKeyframes()[0]?.easing ?? a.effect.getTiming().easing }));
  });

const flat = (easing) => easing.replace(/\s/g, '');
const EASE = 'cubic-bezier(0.2,0.7,0.2,1)';

async function signIn(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('Business email', 'demo@acme.test');
  await page.fill('Password', DEMO_PASSWORD);
  await page.click('button', 'Sign in', { exact: true });
  await page.waitFor(() => location.pathname.startsWith('/dashboard'), [], { what: 'the dashboard after sign-in' });
  // A fresh database: the dashboard sends a company without accounts to Setup first.
  await page.goto(`${BASE}${CHOOSER}`);
  await page.waitIdle();
  if (!(await page.evaluate(() => location.pathname === '/dashboard/setup'))) return;
  await page.click('button', 'Make the 24 words');
  await page.click('button', 'Show words', { exact: true });
  const words = (await page.text('.sx-words li')).map((w) => w.replace(/^\d+\.?\s*/, '').trim());
  await page.click('button', 'I’ve written them down');
  await page.find('heading', 'Check three words');
  const labels = await page.evaluate(() => [...document.querySelectorAll('form label[for^="w"]')].map((l) => l.innerText.trim()));
  for (const label of labels) await page.fill(label, words[Number(label.replace(/\D/g, '')) - 1]);
  await page.click('button', 'Check words', { exact: true });
  await page.click('button', 'Create the key and your accounts');
  await page.find('heading', 'Your accounts are ready', { timeoutMs: 60_000 });
}

/** Both cards on screen, their entrance over. */
async function settled(page) {
  await page.waitFor(() => document.querySelectorAll('.iso-chooser__card').length === 2, [], { what: 'the two cards' });
  await page.waitIdle();
  await page.sleep(900);
}

/**
 * Click a card (or, with `crumb`, the "Invoices" breadcrumb), watching every animation frame for
 * view-transition animations, the fallback's lift and the URL, until the page has changed and 800 ms
 * more have passed (at most 8 s).
 */
async function clickAndWatch(page, label, { crumb = false } = {}) {
  await installProbe(page);
  await page.evaluate(
    (l, c) => {
      const from = location.pathname;
      window.__watch = { vt: [], urlAt: null, chosenAt: null, done: false, t0: performance.now() };
      const tick = () => {
        const w = window.__watch;
        const t = performance.now() - w.t0;
        for (const a of window.__vt()) if (!w.vt.some((x) => x.pseudo === a.pseudo)) w.vt.push({ ...a, t });
        const chosen = document.querySelector('.iso-chooser__card.is-chosen');
        if (w.chosenAt === null && chosen) {
          w.chosenAt = t;
          w.chosenTransition = getComputedStyle(chosen).transitionDuration;
        }
        if (w.urlAt === null && location.pathname !== from) w.urlAt = t;
        if (t < 8000 && (w.urlAt === null || t < w.urlAt + 800)) requestAnimationFrame(tick);
        else w.done = true;
      };
      requestAnimationFrame(tick);
      if (c) document.querySelector('nav[aria-label="Breadcrumb"] a[href="/dashboard/invoices"]').click();
      else [...document.querySelectorAll('.iso-chooser__card')].find((el) => el.innerText.includes(l)).click();
    },
    label,
    crumb,
  );
  await page.waitFor(() => window.__watch?.done === true, [], { what: 'the navigation to settle', timeoutMs: 10_000 });
  return page.evaluate(() => window.__watch ?? null);
}

/** The morph for `name` ran on the chooser's timing, and the rest of the page faded over the same 420 ms. */
function assertMorph(watched, name) {
  const all = JSON.stringify(watched.vt);
  const group = watched.vt.find((a) => a.pseudo === `::view-transition-group(${name})`);
  assert.ok(group, `${name} morphs: ${all}`);
  assert.equal(group.duration, 420, all);
  assert.equal(flat(group.easing), EASE, all);
  const fade = watched.vt.find((a) => a.pseudo === '::view-transition-old(root)');
  assert.ok(fade && fade.name === 'iso-vt-out' && fade.duration === 420 && flat(fade.easing) === EASE, `the rest of the page fades out over 420 ms: ${all}`);
}

async function save(frames, name) {
  if (!FRAMES || !frames.length) return;
  const dir = path.join(FRAMES, name);
  mkdirSync(dir, { recursive: true });
  const sorted = [...frames].sort((a, b) => a.at - b.at);
  const t0 = sorted[0].at;
  sorted.forEach((f, i) => writeFileSync(path.join(dir, `${String(i).padStart(3, '0')}-${Math.round((f.at - t0) * 1000)}ms.jpg`), Buffer.from(f.data, 'base64')));
}

const skip = (!findChrome() && 'no Chrome, Edge or Chromium found (set CHROME_PATH)') || (!DEMO_PASSWORD && 'no seeded demo password in scripts/dev-db.mjs');

test('prompt 11 Phase 3: the Invoices chooser rises, bobs, morphs into its page and back, falls back, and respects reduced motion', { skip, timeout: 600_000 }, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ width: 1440, height: 900 });
    await signIn(page);
    await page.goto(`${BASE}${CHOOSER}`);
    await settled(page);

    // Entrance: the two cards rise 70 ms apart; the coins bob 5 px on a 3.2 s loop.
    const look = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.iso-chooser__card')];
      const coins = [...document.querySelectorAll('.iso-chooser__art')];
      return {
        rise: cards.map((c) => [getComputedStyle(c).animationName, getComputedStyle(c).animationDelay]),
        coins: coins.map((c) => [getComputedStyle(c).animationName, getComputedStyle(c).animationDuration]),
        frames: [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }).find((r) => r.name === 'iso-bob-chooser')?.cssText ?? '',
      };
    });
    assert.deepEqual(look.rise, [['iso-rise', '0s'], ['iso-rise', '0.07s']]);
    assert.deepEqual(look.coins, [['iso-bob-chooser', '3.2s'], ['iso-bob-chooser', '3.2s']]);
    assert.match(look.frames, /translateY\(-5px\)/);

    if (!PROD) {
      // `next dev` doesn't prefetch: one client navigation to each page caches it, as a prefetch would.
      for (const label of ['Pay an invoice', 'Get paid']) {
        await clickAndWatch(page, label);
        await page.waitIdle();
        await clickAndWatch(page, null, { crumb: true });
        await settled(page);
      }
    } else {
      // In production the cards prefetch their pages once on screen; give that a moment.
      await page.sleep(1500);
    }

    // The morph: the chosen card's group animates for 420 ms on cubic-bezier(.2,.7,.2,1); the rest of
    // the page, the other card with it, fades out over the same time. With PROD=1 this is the first
    // click of the session.
    let watched;
    const morphFrames = await page.record(async () => {
      watched = await clickAndWatch(page, 'Pay an invoice');
    });
    await save(morphFrames, 'morph-pay');
    assertMorph(watched, 'iso-inv-pay');
    assert.ok(!watched.vt.some((a) => /iso-inv-get/.test(a.pseudo)), 'the other card has no morph of its own');
    assert.equal(watched.chosenAt, null, 'no fallback where the morph runs');
    assert.equal(await page.evaluate(() => location.pathname), '/dashboard/invoices/pay');
    await page.find('heading', 'Drop an invoice, or paste its text');

    // Back: the breadcrumb returns to the chooser, and the hero morphs back into its card.
    await page.waitIdle();
    const backFrames = await page.record(async () => {
      watched = await clickAndWatch(page, null, { crumb: true });
    });
    await save(backFrames, 'back-pay');
    assertMorph(watched, 'iso-inv-pay');
    assert.equal(await page.evaluate(() => location.pathname), CHOOSER);
    await settled(page);

    // Get paid morphs into its requests card the same way, and back.
    const getFrames = await page.record(async () => {
      watched = await clickAndWatch(page, 'Get paid');
    });
    await save(getFrames, 'morph-get');
    assertMorph(watched, 'iso-inv-get');
    assert.equal(await page.evaluate(() => location.pathname), '/dashboard/invoices/get');
    assert.ok(await page.evaluate(() => /Requests/.test(document.querySelector('#gp-list')?.innerText ?? '')), 'it lands on the requests card');
    await page.waitIdle();
    watched = await clickAndWatch(page, null, { crumb: true });
    assertMorph(watched, 'iso-inv-get');
    await settled(page);

    // Where view transitions can't run: 1.03 on the deeper shadow for 320 ms, then the page.
    await page.evaluate(() => {
      window.__svt = Document.prototype.startViewTransition;
      Object.defineProperty(Document.prototype, 'startViewTransition', { value: undefined, configurable: true, writable: true });
    });
    const fbFrames = await page.record(async () => {
      watched = await clickAndWatch(page, 'Pay an invoice');
    });
    await save(fbFrames, 'fallback-pay');
    assert.equal(watched.vt.length, 0, 'no view transition');
    assert.ok(watched.chosenAt !== null && watched.chosenAt < 100, `the card lifts at once (${watched.chosenAt} ms)`);
    assert.equal(watched.chosenTransition.split(',')[0].trim(), '0.32s');
    assert.ok(watched.urlAt >= 300 && watched.urlAt < 1200, `then the page opens (${watched.urlAt} ms)`);
    assert.equal(await page.evaluate(() => location.pathname), '/dashboard/invoices/pay');
    await page.evaluate(() => {
      Object.defineProperty(Document.prototype, 'startViewTransition', { value: window.__svt, configurable: true, writable: true });
    });
    await page.waitIdle();
    await clickAndWatch(page, null, { crumb: true });
    await settled(page);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.iso-chooser__card')].map((c) => [c.classList.contains('is-chosen'), getComputedStyle(c).opacity])), [[false, '1'], [false, '1']], 'back on the chooser, both cards are as before');

    // Reduced motion: the coins are still, there is no lift or morph, and the page opens straight away.
    await page.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const still = await page.evaluate(() => [...document.querySelectorAll('.iso-chooser__art')].map((c) => getComputedStyle(c).animationName));
    assert.deepEqual(still, ['none', 'none'], 'the coins are still');
    watched = await clickAndWatch(page, 'Pay an invoice');
    assert.equal(watched.chosenAt, null, 'no lift');
    assert.ok(watched.vt.every((a) => a.duration === 0 || a.name === 'none'), `no morph: ${JSON.stringify(watched.vt)}`);
    assert.ok(watched.urlAt !== null && watched.urlAt < 1000, `straight away (${watched.urlAt} ms)`);
    assert.equal(await page.evaluate(() => location.pathname), '/dashboard/invoices/pay');
    await page.waitIdle();
    await clickAndWatch(page, null, { crumb: true });
    await settled(page);
    await page.emulateMedia([]);

    // Keyboard: Enter on a focused card does the same as a click, morph included.
    await page.tabTo(() => document.activeElement?.classList.contains('iso-chooser__card') && document.activeElement.innerText.includes('Get paid'), { what: 'the Get paid card' });
    await installProbe(page);
    await page.evaluate(() => {
      window.__kb = [];
      const t0 = performance.now();
      const tick = () => {
        for (const a of window.__vt()) if (!window.__kb.includes(a.pseudo)) window.__kb.push(a.pseudo);
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.press('Enter');
    await page.waitFor(() => location.pathname === '/dashboard/invoices/get', [], { what: 'Get paid by keyboard' });
    await page.sleep(1200);
    assert.ok((await page.evaluate(() => window.__kb)).includes('::view-transition-group(iso-inv-get)'), 'Enter morphs too');

    // The sidebar's Invoices item always opens the chooser.
    assert.equal(await page.evaluate(() => document.querySelector('a.iso-navitem[href="/dashboard/invoices"]') !== null), true);
  } finally {
    await browser.close();
  }
});
