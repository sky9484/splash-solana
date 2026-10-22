// Prompt 11 Phase 0 and Phase 5: one screenshot of every screen the prompt changes, at 1440 px and at
// 390 px, before and after, under the same names so docs/design/p9/COMPARE.md can put them side by side.
//
// Run it after tests/solana-ui.e2e.mjs has walked the same dev server and database (it needs the
// payments, the template, the T-bills and the requests that walk leaves behind). It signs in as the
// seeded test account demo@acme.test with the seed's own password (never a real person's), changes
// nothing a person would miss (25,000 test USDC credited first, a draft quote it leaves at the approval
// step; sweep is put back as it was), and approves nothing: this browser holds no device key.
//
//   BASE_URL=http://localhost:3200 OUT=docs/design/p9/before node --test tests/p9-screens.e2e.mjs
//
// Env: BASE_URL (default http://localhost:3100), OUT (default docs/design/p9/after), CHROME_PATH. Not
// part of `npm test` (that glob is *.test.mjs).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { findChrome, launch } from './helpers/cdp-browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.OUT ?? 'docs/design/p9/after';
const DEMO_PASSWORD = /const DEMO_PASSWORD = '([^']+)'/.exec(readFileSync('scripts/dev-db.mjs', 'utf8'))?.[1];
const DESKTOP = [1440, 900];
const PHONE = [390, 844];

/** Press the first enabled button (or link) whose name matches one of `names`. Returns the name used. */
async function pressAny(page, names) {
  const used = await page.evaluate((list) => {
    const els = [...document.querySelectorAll('button, a[href], [role=button], [role=radio]')].filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el.getClientRects().length > 0);
    const name = (el) => (el.getAttribute('aria-label') ?? el.innerText ?? '').replace(/\s+/g, ' ').trim();
    for (const want of list) {
      const el = els.find((e) => name(e) === want) ?? els.find((e) => name(e).startsWith(want));
      if (el) {
        el.click();
        return want;
      }
    }
    return null;
  }, names);
  assert.ok(used, `none of ${JSON.stringify(names)} could be pressed`);
  await page.waitIdle({ quietMs: 400 });
  return used;
}

/** An API read from inside the signed-in page. */
const read = (page, p) => page.evaluate(async (url) => (await fetch(url, { cache: 'no-store' })).json(), `/api/solana${p}`);
const post = (page, p, body) => page.evaluate(async (url, b) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json(), `/api/solana${p}`, body);

async function run(page) {
  mkdirSync(OUT, { recursive: true });
  const shots = [];
  let n = 0;
  const shot = async (name) => {
    n += 1;
    const base = `${String(n).padStart(2, '0')}-${name}`;
    await page.sleep(1200);
    // The dev server's own "N" badge isn't part of the app: hidden so it covers nothing in the shot.
    await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.style.setProperty('display', 'none')));
    await page.screenshot(path.join(OUT, `${base}-1440.webp`));
    await page.setViewport(...PHONE);
    await page.sleep(600);
    await page.screenshot(path.join(OUT, `${base}-390.webp`));
    await page.setViewport(...DESKTOP);
    shots.push({ name: base, url: await page.evaluate(() => location.pathname + location.search) });
    console.log(`[screens] ${base}`);
  };

  await page.goto(`${BASE}/login`);
  await page.fill('Business email', 'demo@acme.test');
  await page.fill('Password', DEMO_PASSWORD);
  await page.click('button', 'Sign in', { exact: true });
  await page.waitFor(() => location.pathname.startsWith('/dashboard'), [], { what: 'the dashboard after sign-in' });

  // Overview.
  await page.goto(`${BASE}/dashboard`);
  await page.find('heading', 'Your money, all accounts');
  await page.waitIdle();
  await shot('overview');

  // The walk spends its test money: credit 25,000 test USDC to the Payments account (offline only, the
  // simulator's own top-up), so a quote can reach the approval step.
  await post(page, '/fund', {});

  // Transfer to a bank account, steps 1–5. Step 2 opens from the walk's saved template (the same
  // recipient, amount and answers); step 5 is a paid bank payment from the walk.
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.find('heading', 'Who are you paying?');
  await page.find('text', 'Manila Freight Services Inc.');
  await shot('transfer-bank-1-recipient');
  const { templates } = await read(page, '/templates');
  const tpl = templates.find((t) => t.to === 'bank');
  assert.ok(tpl, 'the walk saved a bank template');
  await page.goto(`${BASE}/dashboard/transfer?template=${tpl.id}`);
  await page.waitFor(() => /step=amount/.test(location.search), [], { what: 'step 2 from the template' });
  await page.find('text', /fits your (limits|rules)/i, { timeoutMs: 30_000 });
  await shot('transfer-bank-2-amount');
  await pressAny(page, ['See routes and cost']);
  await page.waitFor(() => /step=quote/.test(location.search), [], { what: 'step 3', timeoutMs: 60_000 });
  await page.find('button', 'Review and approve', { enabled: true, timeoutMs: 60_000 });
  await shot('transfer-bank-3-route');
  await pressAny(page, ['Review and approve']);
  await page.find('heading', 'Approve this payment', { timeoutMs: 60_000 });
  await shot('transfer-bank-4-approve');
  const company = await read(page, '/company');
  const paid = company.payments.find((p) => p.paymentKind !== 'peer' && p.state === 'anchored');
  assert.ok(paid, 'the walk paid a bank payment, with its proof recorded');
  await page.goto(`${BASE}/dashboard/transfer?payment=${paid.id}&step=track`);
  await page.find('text', /^Proof recorded\./, { timeoutMs: 30_000 });
  await shot('transfer-bank-5-track');

  // Transfer to a business on Splash, steps 1–3.
  await page.goto(`${BASE}/dashboard/transfer?to=splash`);
  await page.fill('Company name, Splash handle or registration number', '@kuchingmarine');
  await page.find('text', 'Kuching Marine Supply');
  await shot('transfer-splash-1-recipient');
  // Before prompt 11 a button paid the business; since Phase 2 a double-click on its row picks it and
  // goes on to the amount.
  const how = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Pay Kuching Marine Supply');
    if (button) return button.click(), 'button';
    const row = [...document.querySelectorAll('.iso-pick__main')].find((b) => /Kuching Marine Supply/.test(b.innerText));
    if (!row) return null;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    return 'row';
  });
  assert.ok(how, 'Kuching Marine Supply can be picked');
  await page.waitFor(() => /step=amount/.test(location.search), [], { what: 'step 2 for a business on Splash' });
  await page.fill('Amount', '1,500');
  await page.fill('Note', 'Spare parts, October');
  await page.find('text', /fits your (limits|rules)/i, { timeoutMs: 30_000 });
  await shot('transfer-splash-2-amount');
  await pressAny(page, ['See routes and cost', 'See the cost']);
  await page.waitFor(() => /step=quote/.test(location.search), [], { what: 'step 3 for a business on Splash', timeoutMs: 60_000 });
  await page.find('button', 'Review and approve', { enabled: true, timeoutMs: 60_000 });
  await shot('transfer-splash-3-route');

  // Invoices: the chooser, Pay, Check (the sample invoice), Get paid.
  await page.goto(`${BASE}/dashboard/invoices`);
  await page.waitFor(() => document.querySelectorAll('.iso-chooser__card').length === 2, [], { what: 'the two choices' });
  await shot('invoices-chooser');
  await page.goto(`${BASE}/dashboard/invoices/pay`);
  await page.find('heading', 'Drop an invoice, or paste its text');
  await shot('invoices-pay');
  await pressAny(page, ['Use the sample invoice']);
  await page.find('heading', 'Check the invoice', { timeoutMs: 30_000 });
  await shot('invoices-check');
  await page.goto(`${BASE}/dashboard/invoices/get`);
  await page.find('heading', 'Get paid');
  await shot('invoices-get-paid');

  // Balance.
  await page.goto(`${BASE}/dashboard/fund`);
  await page.find('heading', 'Balance');
  await shot('balance');

  // Treasury, with Hold and with Sweep (put back as it was).
  const before = (await read(page, '/treasury')).treasury.sweep.on;
  await post(page, '/treasury/sweep', { on: false });
  await page.goto(`${BASE}/dashboard/treasury`);
  await page.find('heading', 'Treasury');
  await page.find('text', 'All accounts');
  await shot('treasury-hold');
  await post(page, '/treasury/sweep', { on: true });
  await page.goto(`${BASE}/dashboard/treasury`);
  await page.find('text', 'All accounts');
  await shot('treasury-sweep');
  await post(page, '/treasury/sweep', { on: before });

  // The Zeke page, and the floating Zeke open.
  await page.goto(`${BASE}/dashboard/zeke`);
  await page.find('heading', /Zeke/);
  await shot('zeke');
  await page.goto(`${BASE}/dashboard`);
  await page.find('heading', 'Your money, all accounts');
  await page.click('button', 'Open Zeke');
  await page.waitFor(() => !!document.querySelector('.iso-zk__panel'), [], { what: 'the floating panel' });
  await shot('zeke-floating-open');

  writeFileSync(path.join(OUT, 'screens.json'), `${JSON.stringify({ base: BASE, takenAt: new Date().toISOString(), widths: [DESKTOP[0], PHONE[0]], shots }, null, 2)}\n`);
  return shots.length;
}

const skip = (!findChrome() && 'no Chrome, Edge or Chromium found (set CHROME_PATH)') || (!DEMO_PASSWORD && 'no seeded demo password in scripts/dev-db.mjs');

test('prompt 11: every changed screen at 1440 px and 390 px', { skip, timeout: 900_000 }, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ width: DESKTOP[0], height: DESKTOP[1] });
    const count = await run(page);
    assert.equal(count, 18);
  } finally {
    await browser.close();
  }
});
