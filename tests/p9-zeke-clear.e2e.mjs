// Prompt 11 Phase 5 review: the floating Zeke (unchanged, Sky's override) must not cover Transfer.
// On every Transfer step, at 1440 × 900, 1280 × 720 and 390 × 844, scrolled to the end of the page,
// no text or control sits under it, so everything can be reached; and at the top of the page the
// step's main action (So far's button, steps 1–3) isn't under it. On a phone, an open dropdown on
// step 2 sits above it. (At the top of a long page, text and a quiet button may pass under a floating
// button until the page scrolls: step 5's "Start a new transfer" at 1440 × 900 with Zeke's nudge
// showing, by 11 px. Zeke itself is Sky's to change.)
//
// Run it after tests/solana-ui.e2e.mjs has walked the same dev server and database (it needs the bank
// template and a paid bank payment that walk leaves behind). It signs in as the seeded test account
// demo@acme.test with the seed's own password (never a real person's), credits test USDC once (the
// simulator's own top-up), leaves draft quotes at step 3, and approves nothing.
//
//   BASE_URL=http://localhost:3200 node --test tests/p9-zeke-clear.e2e.mjs
//
// Env: BASE_URL (default http://localhost:3100), CHROME_PATH. Not part of `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { findChrome, launch } from './helpers/cdp-browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const DEMO_PASSWORD = /const DEMO_PASSWORD = '([^']+)'/.exec(readFileSync('scripts/dev-db.mjs', 'utf8'))?.[1];
const SIZES = [
  [1440, 900],
  [1280, 720],
  [390, 844],
];

const read = (page, p) => page.evaluate(async (url) => (await fetch(url, { cache: 'no-store' })).json(), `/api/solana${p}`);
const post = (page, p, body) => page.evaluate(async (url, b) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json(), `/api/solana${p}`, body);

/**
 * What sits under the floating Zeke: each visible text or control in the page whose box meets one of
 * Zeke's own boxes (its tile, count and nudge). `where` is 'end' (scrolled to the end: every text and
 * control in the page) or 'top' (the top of the page: the step's main action, So far's button).
 */
function covered(where) {
  return new Promise((resolve) => {
    window.scrollTo(0, where === 'end' ? document.documentElement.scrollHeight : 0);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const zk = document.querySelector('.iso.iso-zk');
        if (!zk) return resolve({ zeke: false, hits: [] });
        const boxes = [...zk.querySelectorAll('.iso-zk__tile, .iso-zk__count, .iso-zk__nudge')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
        const scope = where === 'end' ? document.querySelector('.iso-main') : document.querySelector('.iso-sofar__cta');
        if (!scope) return resolve({ zeke: true, hits: [] });
        const control = (el) => el.matches('a, button, input, select, textarea, [role=button], [role=radio], [role=combobox]');
        const leaf = (el) => control(el) || (where === 'end' && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
        const hits = [];
        for (const el of scope.querySelectorAll('*')) {
          if (zk.contains(el) || !leaf(el)) continue;
          const s = getComputedStyle(el);
          if (s.visibility === 'hidden' || s.opacity === '0') continue;
          // A pinned bar's own contents are clear by construction (Zeke rests above the bar).
          for (const r of el.getClientRects()) {
            if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= innerHeight) continue;
            if (boxes.some((z) => r.left < z.right && r.right > z.left && r.top < z.bottom && r.bottom > z.top)) {
              hits.push((el.getAttribute('aria-label') || el.innerText || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60));
              break;
            }
          }
        }
        resolve({ zeke: true, hits });
      }),
    );
  });
}

async function check(page, step, [w, h]) {
  for (const where of ['end', 'top']) {
    const { zeke, hits } = await page.evaluate(covered, where);
    assert.ok(zeke || step === 'approve', `${step} at ${w}×${h}: the floating Zeke is there`);
    assert.deepEqual(hits, [], `${step} at ${w}×${h}, ${where === 'end' ? 'scrolled to the end: nothing' : 'the top of the page: not the main action'} under the floating Zeke`);
  }
  console.log(`[zeke-clear] ${step} at ${w}×${h}: clear`);
}

const skip = (!findChrome() && 'no Chrome, Edge or Chromium found (set CHROME_PATH)') || (!DEMO_PASSWORD && 'no seeded demo password in scripts/dev-db.mjs');

test('the floating Zeke covers nothing on Transfer, at the end of each step, at three sizes', { skip, timeout: 900_000 }, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ width: SIZES[0][0], height: SIZES[0][1] });
    await page.goto(`${BASE}/login`);
    await page.fill('Business email', 'demo@acme.test');
    await page.fill('Password', DEMO_PASSWORD);
    await page.click('button', 'Sign in', { exact: true });
    await page.waitFor(() => location.pathname.startsWith('/dashboard'), [], { what: 'the dashboard after sign-in' });
    // The walk spent its test money: credit test USDC (offline only, the simulator's own top-up) so each
    // step 3 can reach "Review and approve".
    await post(page, '/fund', {});
    const { templates } = await read(page, '/templates');
    const tpl = templates.find((t) => t.to === 'bank');
    assert.ok(tpl, 'the walk saved a bank template');
    const paid = (await read(page, '/company')).payments.find((p) => p.paymentKind !== 'peer' && p.state === 'anchored');
    assert.ok(paid, 'the walk paid a bank payment');

    for (const size of SIZES) {
      await page.setViewport(size[0], size[1]);
      await page.goto(`${BASE}/dashboard/transfer`);
      await page.find('heading', 'Who are you paying?');
      await page.waitIdle();
      await check(page, 'bank 1 Recipient', size);
      await page.goto(`${BASE}/dashboard/transfer?template=${tpl.id}`);
      await page.waitFor(() => /step=amount/.test(location.search), [], { what: 'step 2 from the template' });
      await page.find('text', /fits your (limits|rules)/i, { timeoutMs: 30_000 });
      await check(page, 'bank 2 Amount', size);
      if (size[0] < 500) {
        // An open dropdown sits above Zeke: what is at each option's centre is the option.
        // "Where this money comes from", the lowest field on the step, nearest Zeke. It opens on focus.
        await page.evaluate(() => {
          const label = [...document.querySelectorAll('.iso-main label')].find((l) => l.textContent.trim().startsWith('Where this money comes from'));
          const input = label && document.getElementById(label.htmlFor);
          input?.scrollIntoView({ block: 'end' });
          input?.focus();
        });
        await page.waitFor(() => document.querySelectorAll('[role=listbox] [role=option]').length > 0, [], { what: 'the dropdown open' });
        const onTop = await page.evaluate(() =>
          [...document.querySelectorAll('[role=listbox] [role=option]')].every((o) => {
            const r = o.getBoundingClientRect();
            if (r.bottom <= 0 || r.top >= innerHeight) return true;
            const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !!at && o.contains(at);
          }),
        );
        assert.ok(onTop, 'every option of the open dropdown is above the floating Zeke');
        await page.press('Escape');
        console.log('[zeke-clear] step 2 dropdown at 390: above Zeke');
      }
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'See routes and cost')?.click());
      await page.waitFor(() => /step=quote/.test(location.search), [], { what: 'step 3', timeoutMs: 60_000 });
      await page.find('button', 'Review and approve', { enabled: true, timeoutMs: 60_000 });
      await check(page, 'bank 3 Route', size);
      await page.goto(`${BASE}/dashboard/transfer?payment=${paid.id}&step=track`);
      await page.find('text', /^Proof recorded\./, { timeoutMs: 30_000 });
      await check(page, 'bank 5 Track', size);
      await page.goto(`${BASE}/dashboard/transfer?to=splash`);
      await page.fill('Company name, Splash handle or registration number', '@kuchingmarine');
      await page.find('text', 'Kuching Marine Supply');
      await check(page, 'Splash 1 Recipient', size);
      await page.evaluate(() => {
        const row = [...document.querySelectorAll('.iso-pick__main')].find((b) => /Kuching Marine Supply/.test(b.innerText));
        row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
      });
      await page.waitFor(() => /step=amount/.test(location.search), [], { what: 'step 2 for a business on Splash' });
      await page.fill('Amount', '1,500');
      await page.find('text', /fits your (limits|rules)/i, { timeoutMs: 30_000 });
      await check(page, 'Splash 2 Amount', size);
    }
  } finally {
    await browser.close();
  }
});
