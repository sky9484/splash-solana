// Browser walkthrough of the signed-in Solana dashboard (offline mode), with a screenshot of every
// step at 1440 px and at 390 px. Asserts that no request the page makes carries the recovery words
// (they stay in the browser), and that the page logs no errors.
//
// One company, one browser: a company has one vault and the device key lives in this browser's
// IndexedDB, so the walk runs once at 1440 px and shoots each step at both widths. Then it pays a
// second invoice entirely at 390 px, so the phone layout is clicked through, not only looked at.
//
// Needs a fresh in-memory dev database and a dev server in offline mode, then an installed Chrome,
// Edge or Chromium (no npm package, no browser download: tests/helpers/cdp-browser.mjs):
//   node --experimental-strip-types --import ./scripts/alias-hook.mjs scripts/dev-db.mjs
//   SPLASH_SOLANA_MODE=offline npx next dev -p 3100
//   node --test tests/solana-ui.e2e.mjs
// It signs in as the seeded demo@acme.test and starts at setup, so restart the dev database to run it
// again. It ends in the staff console (prompt 07 §7), with the dev staff login.
//
// Never point it at a dev server someone is using: it takes over demo@acme.test's company. Run its own
// beside it instead, with its own database and output folder (next.config.ts NEXT_DIST_DIR):
//   DEV_DB_PORT=5434 node --experimental-strip-types --import ./scripts/alias-hook.mjs scripts/dev-db.mjs
//   NEXT_DIST_DIR=.next-e2e DATABASE_URL=postgres://postgres@127.0.0.1:5434/postgres?sslmode=disable \
//     SPLASH_SOLANA_MODE=offline npx next dev -p 3200
//   BASE_URL=http://localhost:3200 node --test tests/solana-ui.e2e.mjs
// (next dev adds the .next-e2e folders to tsconfig.json's include; restore it afterwards.)
// Env: BASE_URL (default http://localhost:3100), SCREENSHOT_DIR (default
// docs/solana-build/screenshots), CHROME_PATH. Not part of `npm test` (that glob is *.test.mjs).
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { findChrome, launch } from './helpers/cdp-browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.SCREENSHOT_DIR ?? 'docs/solana-build/screenshots';
// The seeded demo password, read from the seed itself so it lives in one place.
const DEMO_PASSWORD = /const DEMO_PASSWORD = '([^']+)'/.exec(readFileSync('scripts/dev-db.mjs', 'utf8'))?.[1];
// The dev staff login: ADMIN_EMAIL / ADMIN_PASSWORD when set, else the dev fallback in admin-auth.ts.
const adminSource = readFileSync('lib/server/admin-auth.ts', 'utf8');
const ADMIN = {
  email: process.env.ADMIN_EMAIL ?? /const fallbackEmail = '([^']+)'/.exec(adminSource)?.[1],
  password: process.env.ADMIN_PASSWORD ?? /const fallbackPassword = '([^']+)'/.exec(adminSource)?.[1],
};
const chrome = findChrome();

const DESKTOP = [1440, 900];
const PHONE = [390, 844];

/**
 * A fresh `next dev` compiles each route on its first request, and with the dev cache off that can
 * take 15 s or more a route. On the money path that is long enough for a 60 s quote to lapse between
 * "Review" and "Approve". So every Solana API route is compiled first (an unauthenticated GET: it
 * answers 401 or 405 and changes nothing), and the walk then times only the product.
 */
async function warmRoutes() {
  const routes = [];
  const walkDir = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walkDir(full);
      else if (name === 'route.ts') routes.push(`/${path.relative('app', dir).split(path.sep).join('/').replace(/\[[^\]]+\]/g, 'warm')}`);
    }
  };
  for (const root of ['app/api/solana', 'app/api/setup', 'app/api/auth']) walkDir(root);
  const started = Date.now();
  // One at a time, the pages first: compiling several at once can leave a page pointing at a chunk
  // the dev server is still rebuilding.
  const hit = (r) => fetch(`${BASE}${r}`, { redirect: 'manual' }).then(async (res) => ({ status: res.status, html: (res.headers.get('content-type') ?? '').includes('text/html'), body: await res.arrayBuffer() })).catch(() => null);
  const unfound = [];
  for (const r of ['/', '/login', ...routes]) {
    let res = await hit(r);
    // Next's own HTML "not found" for a route file that exists (no [id] in it) is the dev server
    // racing its compile, not an answer from the route: one Phase 2 run kept /treasury/fund at 404
    // for the rest of the walk. Ask again until the route answers for itself.
    for (let tries = 0; res && res.status === 404 && res.html && !r.includes('/warm') && tries < 5; tries++) {
      await new Promise((ok) => setTimeout(ok, 2000));
      res = await hit(r);
    }
    if (res && res.status === 404 && res.html && !r.includes('/warm')) unfound.push(r);
  }
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`[walk] compiled ${routes.length} API routes and the first pages in ${Math.round((Date.now() - started) / 1000)}s`);
  if (unfound.length) console.log(`[walk] the dev server still says "not found" for: ${unfound.join(', ')}`);
}

async function walk(email) {
  mkdirSync(OUT, { recursive: true });
  await warmRoutes();
  const browser = await launch();
  try {
    const page = await browser.newPage({ width: DESKTOP[0], height: DESKTOP[1] });
    try {
      return await run(page, email);
    } catch (e) {
      // Leave evidence of where it stopped: the screen, and any error it shows.
      await page.screenshot(path.join(OUT, 'FAILED.webp')).catch(() => {});
      const shown = await page.evaluate(() => [...document.querySelectorAll('[role=alert], .sx-notice-error, .iso-note--danger')].map((el) => el.innerText.trim()).filter(Boolean)).catch(() => []);
      console.log(`[walk] stopped at ${await page.evaluate(() => location.pathname + location.search).catch(() => '?')}; on screen: ${JSON.stringify(shown)}; page errors: ${JSON.stringify(page.errors.slice(-5))}; requests never finished: ${JSON.stringify([...new Set(page.stuck)].slice(-8))}`);
      throw e;
    }
  } finally {
    await browser.close();
  }
}

async function run(page, email) {
  let n = 0;
  /** The current step at both widths: desktop-NN-name.webp and mobile-NN-name.webp. */
  const shot = async (name) => {
    console.log(`[walk] ${new Date().toISOString().slice(11, 19)} ${name}`);
    n += 1;
    const nn = String(n).padStart(2, '0');
    await page.screenshot(path.join(OUT, `desktop-${nn}-${name}.webp`));
    await page.setViewport(...PHONE);
    await page.screenshot(path.join(OUT, `mobile-${nn}-${name}.webp`));
    await page.setViewport(...DESKTOP);
  };
  /** A Combobox: type to filter, then choose the option that starts with `option`. */
  const choose = async (label, option) => {
    await page.fill(label, option);
    await page.waitFor((o) => [...document.querySelectorAll('[role=option]')].some((x) => x.innerText.replace(/\s+/g, ' ').trim().startsWith(o)), [option], { what: `the option ${option}` });
    await page.evaluate((o) => [...document.querySelectorAll('[role=option]')].find((x) => x.innerText.replace(/\s+/g, ' ').trim().startsWith(o)).click(), option);
    await page.waitIdle({ quietMs: 300 });
  };
  /** Press a button as soon as it is enabled, without waiting for the network to go quiet (a quote is short-lived). */
  const tap = async (name) => {
    await page.find('button', name, { enabled: true });
    await page.evaluate(() => {
      const el = document.querySelector('[data-e2e-hit]');
      el.removeAttribute('data-e2e-hit');
      el.click();
    });
  };
  /** Transfer's intent header (prompt 11 §2.1), as the page shows it. */
  const header = () =>
    page.evaluate(() => {
      const h = document.querySelector('.iso-txhead');
      if (!h) return null;
      const facts = Object.fromEntries([...h.querySelectorAll('.iso-txhead__metrics > div')].map((d) => [d.querySelector('dt').innerText.trim(), d.querySelector('dd').innerText.trim()]));
      return { status: h.querySelector('[data-testid=tx-status]').innerText.trim(), title: h.querySelector('#tx-title').innerText.trim(), sub: h.querySelector('.iso-txhead__sub').innerText.trim(), step: h.querySelector('.iso-txhead__stepline').innerText.replace(/\s+/g, ' ').trim(), links: [...h.querySelectorAll('.iso-txhead__seglink')].map((a) => a.getAttribute('aria-label')), facts };
    });
  /** Money as the app writes it (lib/solana-zeke/router.ts formatUsd, half-up to cents; formatPhp). */
  const usdText = (minor) => {
    const cents = (BigInt(minor) + 5_000n) / 10_000n;
    return `US$${(cents / 100n).toLocaleString('en-US')}.${String(cents % 100n).padStart(2, '0')}`;
  };
  const phpText = (minor) => `₱${(BigInt(minor) / 100n).toLocaleString('en-US')}.${String(BigInt(minor) % 100n).padStart(2, '0')}`;
  const STEP_NAMES = { recipient: 'Recipient', amount: 'Amount', quote: 'Route', approve: 'Approve', track: 'Track' };
  /**
   * Prompt 11 §2.1: every value in the header comes from server state. Reads the payment the URL names
   * from the server and checks what they receive, what you pay, the rail, the quote's clock (or its
   * lock at step 5), the step, the status, and that only steps 2 and 3 link back.
   */
  const headerMatchesServer = async (step, status) => {
    await page.waitFor((want) => document.querySelector('.iso-txhead__stepline')?.innerText.includes(want), [STEP_NAMES[step]], { what: `the header on ${step}` });
    const id = await page.evaluate(() => new URLSearchParams(location.search).get('payment'));
    const p = await page.evaluate(async (pid) => (await (await fetch(`/api/solana/payments/${pid}`, { cache: 'no-store' })).json()).payment, id);
    const lanes = [...p.cards, ...(p.compare ? [p.compare] : [])];
    const picked = step === 'quote' ? await page.evaluate(() => document.querySelector('.iso-route[aria-checked="true"]')?.dataset.radioValue ?? null) : p.selectedQuoteId;
    const card = lanes.find((c) => c.quoteId === picked) ?? p.cards[0];
    const peer = p.kind === 'peer';
    const h = await header();
    assert.equal(h.facts['They receive'], peer ? usdText(card.receivePhpMinor) : phpText(card.receivePhpMinor), `${step}: They receive`);
    assert.equal(h.facts['You pay'], usdText(card.youPayUsdcMinor), `${step}: You pay`);
    assert.equal(h.facts['Paid out by'], peer ? 'Inside Splash' : card.arrives, `${step}: Paid out by`);
    if (peer) assert.equal(h.facts.Quote, 'No conversion', `${step}: Quote`);
    else if (step === 'track') assert.equal(h.facts.Quote, `Locked at ${card.rate}`, `${step}: Quote`);
    else assert.match(h.facts.Quote, /^(New quote in \d:\d\d|Quote ran out)$/, `${step}: Quote`);
    const n = ['recipient', 'amount', 'quote', 'approve', 'track'].indexOf(step) + 1;
    assert.equal(h.step, `Step ${n} of 5 ${STEP_NAMES[step]}`);
    if (status) assert.match(h.status, status, `${step}: status ${h.status}`);
    // Back: steps 2 and 3 link back to the steps before them; Approve and Track never do.
    assert.deepEqual(h.links, step === 'quote' ? ['Back to recipient', 'Back to amount'] : step === 'amount' ? ['Back to recipient'] : [], `${step}: back links`);
    return h;
  };
  /** Approve on this device, then Track opens by itself (prompt 11 §2.3). */
  const approveThenTrack = async (timeoutMs = 60_000) => {
    await page.click('button', 'Approve on this device');
    await page.waitFor(() => /step=track/.test(location.search) || [...document.querySelectorAll('.iso-approved')].some((e) => /^Approved\. Sending now\./.test(e.innerText.trim())), [], { what: '"Approved. Sending now."', timeoutMs });
    await page.waitFor(() => /step=track/.test(location.search), [], { what: 'Track to open by itself', timeoutMs: 30_000 });
  };
  /** One width only: a state that exists only on a desktop (the collapsed rail) or on a phone (its menu). */
  const shotOne = async (name, width) => {
    console.log(`[walk] ${new Date().toISOString().slice(11, 19)} ${name} (${width})`);
    n += 1;
    const nn = String(n).padStart(2, '0');
    if (width === 'mobile') await page.setViewport(...PHONE);
    await page.screenshot(path.join(OUT, `${width}-${nn}-${name}.webp`));
    if (width === 'mobile') await page.setViewport(...DESKTOP);
  };

  // Landing, signed out.
  await page.goto(`${BASE}/`);
  await page.find('heading', 'Pay suppliers abroad. Prove every payment.');
  await shot('landing');

  // Sign in.
  await page.goto(`${BASE}/login`);
  await page.fill('Business email', email);
  await page.fill('Password', DEMO_PASSWORD);
  await page.click('button', 'Sign in', { exact: true });
  await page.waitFor(() => location.pathname.startsWith('/dashboard'), [], { what: 'the dashboard after sign-in' });
  await page.waitIdle();

  // Setup: recovery kit → three words → device key and vault.
  await page.goto(`${BASE}/dashboard/setup`);
  await page.click('button', 'Make the 24 words');
  await page.find('heading', 'Your recovery kit');
  await shot('recovery-kit-hidden');
  await page.click('button', 'Show words', { exact: true });
  const words = (await page.text('.sx-words li')).map((w) => w.replace(/^\d+\.?\s*/, '').trim());
  assert.equal(words.length, 24);
  assert.ok(words.every((w) => /^[a-z]+$/.test(w)), `shown words are plain BIP39 words: ${words.slice(0, 2).join(' ')}…`);
  await shot('recovery-kit-shown');
  await page.click('button', 'I’ve written them down');
  await page.find('heading', 'Check three words');
  const labels = await page.evaluate(() => [...document.querySelectorAll('form label[for^="w"]')].map((l) => l.innerText.trim()));
  assert.equal(labels.length, 3);
  for (const label of labels) await page.fill(label, words[Number(label.replace(/\D/g, '')) - 1]);
  await shot('three-word-check');
  await page.click('button', 'Check words', { exact: true });
  await page.find('heading', 'A key for this device, and your accounts');
  await shot('device-key');
  await page.click('button', 'Create the key and your accounts');
  await page.find('heading', 'Your accounts are ready', { timeoutMs: 60_000 });
  assert.match((await page.text('.sx-kv')).join('\n'), /Config authority: none/);
  await shot('vault-ready');

  // The shell (prompt 10 Phase 1): Overview, then Pay, Money, Contacts and Control; the setup card;
  // the top row; Zeke floating, quiet while nothing waits.
  await page.goto(`${BASE}/dashboard`);
  await page.waitFor(() => !!document.querySelector('.iso-zk__launch') && !!document.querySelector('.iso-ratestrip'), [], { what: 'the shell' });
  const groups = await page.evaluate(() => [...document.querySelectorAll('aside .iso-navgroup')].map((g) => [...g.querySelectorAll('.iso-navgroup__title, .iso-navitem__label')].map((e) => e.textContent.trim()).join('|')));
  assert.deepEqual(groups, ['Overview', 'Pay|Transfer|Invoices|Batch payout', 'Money|Balance|Treasury|History', 'Contacts|Recipients', 'Control|Rules|Zeke']);
  assert.match((await page.text('.iso-ratestrip')).join(' '), /USD → PHP 57\.40\s*test rate/);
  assert.equal(await page.evaluate(() => document.querySelector('.iso-zk__nudge')), null, 'no nudge while nothing waits');
  // Overview, before any money or payment (prompt 10 Phase 2): the money position says so, and the
  // only thing that needs you is setup (the optional second approver ranks last, §4.2.4). The
  // "Nothing needs you." state is rendered from a fixture in tests/overview-honesty.test.mjs.
  await page.find('heading', 'Your money, all accounts');
  await page.find('text', 'No money in your accounts yet.');
  await page.find('text', 'Add a second approver');
  await page.find('text', 'No payments yet.');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.iso-extrude')].filter((e) => e.getClientRects().length).length), 1, 'one extruded number');
  await shot('overview-empty');
  await shot('shell-sidebar');
  await page.click('button', 'Collapse navigation');
  await page.evaluate(() => document.querySelector('a.iso-navitem[href="/dashboard/zeke"]')?.focus());
  await page.sleep(400);
  await shotOne('shell-collapsed', 'desktop');
  await page.click('button', 'Expand navigation');
  await page.setViewport(...PHONE);
  await page.click('button', 'Open navigation');
  await page.find('text', 'Contacts');
  await page.screenshot(path.join(OUT, `mobile-${String(++n).padStart(2, '0')}-shell-phone-menu.webp`));
  await page.click('button', 'Close navigation');
  await page.setViewport(...DESKTOP);
  // Zeke opens on the page it's on, and has no approve control.
  await page.click('button', 'Open Zeke');
  await page.find('text', /Looking at:\s*Overview/);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.iso-zk__panel button')].filter((b) => /approve/i.test(b.textContent)).length), 0, 'no approve button in the floating panel');
  await shot('zeke-open');
  await page.click('button', 'Close Zeke');
  await page.goto(`${BASE}/dashboard/zeke`);
  await page.waitIdle();
  assert.equal(await page.evaluate(() => document.querySelector('.iso-zk')), null, 'the floating Zeke steps aside on the Zeke page');

  // Treasury (prompt 10 Phase 5): the three accounts; test money into the Reserve, then a move that
  // funds the Payments account. The wire between them carries coins only while the sheet is open.
  await page.goto(`${BASE}/dashboard/treasury`);
  await page.find('heading', 'All accounts');
  await page.find('text', 'Nothing is moving right now');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.iso-treasury__hero .iso-wire--active').length), 0, 'no coins while nothing moves');
  await page.click('button', 'Move money between accounts');
  await page.find('heading', 'Move money between accounts');
  await page.find('text', 'Showing where the money would move');
  await page.click('button', 'Add test money to your Reserve');
  await page.waitFor(() => [...document.querySelectorAll('.iso-treasury__hero .iso-station__amount')].some((e) => e.innerText.trim() === 'US$100,000.00'), [], { what: 'the Reserve funded' });
  await shot('treasury-funded');
  await page.fill('Amount from your Reserve', '30,000');
  await page.click('button', 'Approve on this device', { exact: true });
  await page.find('text', /^Moved US\$30,000\.00 to your Payments account\./, { timeoutMs: 60_000 });
  await shot('treasury-moved');
  await page.press('Escape');
  await page.goto(`${BASE}/dashboard/fund`);
  await page.find('text', /US\$30,000\.00/);
  await shot('balance-funded');

  // Invoices (prompt 10 Phase 4): the chooser, then Pay an invoice, Check the invoice, and the handoff
  // to Transfer's Step 3 (one engine, one approval card).
  const NO_FULL_NUMBER = /0021-8830-4471|002188304471|0021 8830 4471/;
  await page.goto(`${BASE}/dashboard/invoices`);
  await page.find('heading', 'Invoices');
  await page.waitFor(() => document.querySelectorAll('.iso-chooser__card').length === 2, [], { what: 'the two choices' });
  await page.waitIdle();
  assert.equal(await page.evaluate(() => document.querySelectorAll('.iso-chooser__tags').length), 0, 'no counts while every count is zero');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.iso-chooser__card')].map((a) => a.getAttribute('href'))), ['/dashboard/invoices/get', '/dashboard/invoices/pay']);
  assert.equal(await page.evaluate(() => document.querySelector('a.iso-navitem[href="/dashboard/invoices"]') !== null), true, 'the sidebar item opens the chooser');
  await shot('invoices-chooser');
  // ?mode= only redirects to the sub-route.
  await page.goto(`${BASE}/dashboard/invoices?mode=pay`);
  await page.waitFor(() => location.pathname === '/dashboard/invoices/pay', [], { what: '?mode=pay to redirect' });
  await page.find('heading', 'Drop an invoice, or paste its text');
  await shot('invoices-pay');
  await page.click('button', 'Use the sample invoice');
  await page.find('heading', 'Check the invoice', { timeoutMs: 30_000 });
  await page.find('heading', 'Zeke’s draft');
  // Every field names the line it came from; the account number is masked in the document too.
  const helps = await page.text('.iso-checkrow__help');
  assert.equal(helps.length, 5);
  assert.ok(helps.every((h) => /^From line \d+/.test(h.trim())), `every field has its line: ${helps.join(' | ')}`);
  assert.match((await page.text('.iso-doc__lines')).join('\n'), /Account Number: •••• •••• 4471/);
  assert.doesNotMatch((await page.text('main')).join('\n'), NO_FULL_NUMBER, 'no full number on the page');
  await page.find('text', /^New bank details\./);
  await page.find('text', 'Waiting for the call-back above.');
  await shot('check-invoice');
  // "Show number": a device approval, then 30 seconds, then masked again.
  await page.click('button', 'Show number');
  await page.waitFor(() => /0021 8830 4471/.test(document.querySelector('.iso-draft')?.innerText ?? ''), [], { what: 'the number shown' });
  await page.find('text', /hidden in 0:\d\d/);
  await shot('check-invoice-reveal');
  await page.click('button', 'Hide');
  await page.waitFor(() => !/0021 8830 4471/.test(document.querySelector('.iso-draft')?.innerText ?? ''), [], { what: 'the number masked again' });
  // The call-back: who you spoke to, on a number from your own records.
  await page.click('button', 'I called them');
  await page.find('heading', 'Record the call-back');
  await page.fill('Who you spoke to', 'Rhea Santos, accounts');
  await page.fill('Number you called', '+63 2 8700 1100');
  await page.click('button', 'Mark verified');
  await page.find('text', /^Verified by .+, on \+63 2 8700 1100 \(from your records\)/);
  await page.evaluate(() => document.querySelectorAll('.iso-tickbtn[aria-label$=": mark as checked"]').forEach((b) => b.click()));
  await page.waitFor(() => document.querySelectorAll('.iso-tickbtn[aria-pressed="true"][aria-label$=": checked"]').length === 5, [], { what: 'five ticks' });
  await shot('check-invoice-verified');
  await tap('Confirm and pay');
  // The handoff: Transfer's Step 3 (prompt 11 §2.3, "Pick a route"), under the intent header with the
  // recipient, the amount, the invoice number and the invoice.
  await page.waitFor(() => location.pathname === '/dashboard/transfer' && /step=quote/.test(location.search) && /payment=pay_/.test(location.search), [], { what: 'Transfer Step 3' });
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  const handoff = (await page.text('main')).join('\n');
  assert.match(handoff, /INV-0412/, 'the invoice and its number are there');
  assert.match(handoff, /Manila Freight/, 'the recipient is there');
  assert.match(handoff, /BDO Unibank, Inc\./, 'with the bank the invoice named');
  assert.match(handoff, /₱560,000/, 'the amount is there');
  assert.match((await header()).title, /^Pay Manila Freight/, 'the header names who is paid');
  await headerMatchesServer('quote', /^Draft$/);
  await shot('invoice-handoff-quote');
  await page.find('button', 'Review and approve', { enabled: true, timeoutMs: 60_000 });
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this payment');
  await headerMatchesServer('approve', /^Waiting for you$/);
  const invoiceCard = (await page.text('.iso-approve')).join('\n');
  assert.match(invoiceCard, /Zeke drafted this payment\. Zeke can’t approve; only you can\./);
  assert.match(invoiceCard, /INV-0412/);
  assert.match(invoiceCard, /₱560,000\.00/);
  // The payment now waits for approval: Zeke's one nudge and the Overview badge, from the server's count.
  // Approve is a step of its own now and Zeke steps aside while it is open, so look from Overview.
  const approveUrl = await page.evaluate(() => location.pathname + location.search);
  await page.goto(`${BASE}/dashboard`);
  await page.waitFor(() => /1 draft needs your approval/.test(document.querySelector('.iso-zk__nudge')?.textContent ?? ''), [], { what: "Zeke's nudge" });
  assert.equal(await page.evaluate(() => document.querySelector('a.iso-navitem[href="/dashboard"] .iso-navbadge')?.textContent.trim()), '1');
  await shotOne('zeke-nudge', 'desktop');
  await page.goto(`${BASE}${approveUrl}`);
  await page.find('heading', 'Approve this payment');
  await shot('approve-card');
  await approveThenTrack();
  await page.find('heading', 'Paid, with proof recorded', { timeoutMs: 60_000 });
  await page.find('text', /^Proof recorded\./, { timeoutMs: 60_000 });
  await headerMatchesServer('track', /^Paid$/);
  await shot('done-evidence');

  // Receipt: verify, trace on Solscan, then tamper.
  await page.click('link', 'Full receipt');
  await page.find('heading', 'Verify this receipt');
  await page.click('button', 'Verify', { exact: true });
  await page.find('heading', /^Verified\. This record matches/);
  const receiptPath = await page.evaluate(() => location.pathname);
  // The trace names the memo on every payment transaction. Offline the signatures exist on no
  // network, so it says so and links none of them: a Solscan link to a simulated signature would 404.
  await page.find('heading', 'Trace it on Solscan');
  const trace = (await page.text('section[aria-labelledby="trace-title"]')).join('\n');
  assert.match(trace, /splash:pay:v1:\S+/, 'the memo is shown');
  assert.match(trace, /offline simulator, so they are on no network/);
  const links = await page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby="trace-title"] a')].map((a) => a.href));
  assert.ok(links.every((h) => /^https:\/\/solscan\.io\/(tx|account)\/\w+(\?cluster=devnet)?$/.test(h)), `only Solscan links: ${links.join(', ')}`);
  await shot('receipt-verified');
  await page.check('Tamper with a field (demo)');
  await page.click('button', 'Verify', { exact: true });
  await page.find('heading', /^Does not verify\./);
  await shot('receipt-tampered');

  // The auditor's view: a share link opens this receipt only, read-only.
  const receiptId = receiptPath.split('/').pop();
  const share = await page.evaluate(async (id) => {
    const res = await fetch(`/api/solana/receipts/${id}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    return res.json();
  }, receiptId);
  assert.match(share.path, /^\/receipt\/shr_[0-9a-f]{32}$/);
  await page.goto(`${BASE}${share.path}`);
  await page.find('text', 'Read-only receipt');
  await page.click('button', 'Verify', { exact: true });
  await page.find('heading', /^Verified\. This record matches/);
  await shot('receipt-shared-auditor');

  // The bill now sits on the Paid tab with its receipt; the chooser's counts are still zero for it.
  await page.goto(`${BASE}/dashboard/invoices/pay`);
  await page.find('heading', 'Bills');
  await page.click('button', /^Paid/);
  await page.waitFor(() => /INV-0412/.test(document.querySelector('[role=tabpanel]')?.innerText ?? ''), [], { what: 'the paid bill' });
  assert.match((await page.text('[role=tabpanel]')).join('\n'), /Paid · proof recorded/);
  await shot('invoices-paid');

  // Transfer (prompt 11 Phase 2; prompt 10 Phase 3): Recipient, Amount, Route, Approve, Track, under one
  // intent header whose figures are the server's. A new bank recipient (the full number typed twice,
  // checked by call-back), then the amount, the route, the approval and the tracker driven by the
  // payment's real state, to a verified receipt.
  const TIME_WORDS = /\b(\d+\s*(?:s|sec|seconds?|min|minutes?|hours?|days?)\b|same day|arrives? by|instant(?:ly)?|in minutes|faster)/i;
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.find('heading', 'Who are you paying?');
  await page.find('text', 'Manila Freight Services Inc.');
  const h1 = await header();
  assert.deepEqual([h1.status, h1.title, h1.step, h1.links], ['Draft', 'Send a payout', 'Step 1 of 5 Recipient', []]);
  assert.deepEqual(h1.facts, { 'They receive': 'Set at step 2', 'You pay': 'Not yet', 'Paid out by': 'Bank', Quote: 'At step 3' });
  await shot('transfer-recipient');
  await page.click('button', 'New recipient');
  await page.find('heading', 'New bank recipient');
  await page.fill('Business name', 'Cebu Logistics Inc.');
  await page.fill('SEC or DTI registration number', 'CS202054321');
  await choose('Bank', 'BPI');
  await page.fill('Full account number', '1234567890');
  // The second entry refuses a paste, so a copied mistake can't slip through twice.
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) => l.innerText.trim() === 'Type it again');
    document.getElementById(label.htmlFor).dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }));
  });
  await page.waitFor(() => [...document.querySelectorAll('.iso-field__error')].some((e) => /Pasting is off here/.test(e.innerText)), [], { what: 'the paste refusal' });
  await page.fill('Type it again', '1234567890');
  await page.fill('Account holder name', 'Cebu Logistics Inc.');
  await page.fill('Street address', '12 Osmeña Boulevard');
  await page.fill('City', 'Cebu City');
  await page.waitFor(() => !!document.querySelector('.iso-field__okmark'), [], { what: 'the match tick' });
  await shot('transfer-new-recipient');
  await page.click('button', 'Save recipient');
  await page.waitFor(() => !document.querySelector('.iso-sheet-root'), [], { what: 'the sheet to close' });
  await page.find('text', 'Cebu Logistics Inc.');
  // The number itself never comes back: the list has the last 4 only.
  assert.doesNotMatch((await page.text('main')).join('\n'), /1234567890|1234 5678 90/);
  // "Show number": the owner or a finance admin, after a device approval, for 30 seconds.
  await page.click('button', 'Cebu Logistics Inc.: details');
  await page.click('button', 'Show number');
  await page.find('text', /^Hidden again in 0:\d\d$/);
  assert.match((await page.text('.iso-sheet .iso-dl')).join('\n'), /1234 5678 90/);
  await shot('transfer-recipient-reveal');
  await page.click('button', 'Hide now');
  await page.waitFor(() => /•••• 7890/.test(document.querySelector('.iso-sheet .iso-dl')?.innerText ?? ''), [], { what: 'the number masked again' });
  await page.press('Escape');
  await page.waitFor(() => !document.querySelector('.iso-sheet-root'), [], { what: 'the sheet to close on Esc' });

  // The new recipient is picked: the header names them before any amount.
  await page.waitFor(() => document.getElementById('tx-title')?.innerText.trim() === 'Pay Cebu Logistics Inc.', [], { what: 'the header to name the new recipient' });
  await page.click('button', 'Continue to amount');
  await page.find('heading', 'How much?');
  await page.fill('They receive', '75,000');
  // Step 2's header: the amount, "about" what you pay, and the rail, from the server's estimate.
  await page.waitFor(() => /PESONet/.test(document.querySelector('.iso-txhead__metrics')?.innerText ?? ''), [], { what: 'Paid out by PESONet in the header' });
  const h2 = await header();
  assert.equal(h2.facts['They receive'], '₱75,000.00');
  assert.match(h2.facts['You pay'], /^about US\$1,30\d\.\d\d$/);
  assert.deepEqual([h2.step, h2.links, h2.facts.Quote], ['Step 2 of 5 Amount', ['Back to recipient'], 'At step 3']);
  await page.fill('What was bought', 'Pallets and stretch film');
  await choose('How you know them', 'Supplier');
  await choose('Where this money comes from', 'Business revenue');
  // Prompt 11 §1.3: on a phone, with the field at the bottom of the window (where the list used to open
  // under the sticky action bar), the list opens in a portal above everything, inside the window, and
  // its last option takes the click: nothing covers it.
  await page.setViewport(...PHONE);
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) => l.innerText.trim() === 'Where this money comes from');
    const input = document.getElementById(label.htmlFor);
    input.scrollIntoView({ block: 'end' });
    // The field still has focus from the choice above; a person taps it again, which opens the list.
    input.blur();
    input.focus();
  });
  await page.waitFor(() => document.querySelectorAll('[role=listbox] [role=option]').length > 1, [], { what: 'the open list' });
  await page.sleep(300);
  const lastOption = await page.evaluate(() => {
    const list = document.querySelector('[role=listbox]');
    const opts = [...list.querySelectorAll('[role=option]')];
    const last = opts[opts.length - 1];
    last.scrollIntoView({ block: 'nearest' });
    const r = last.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { label: last.querySelector('span').innerText.replace(/\s+/g, ' ').trim(), onTop: last.contains(hit), inWindow: box.top >= 0 && box.bottom <= innerHeight, outsideMain: !list.closest('main'), z: getComputedStyle(list).zIndex, side: list.dataset.side };
  });
  assert.ok(lastOption.outsideMain, 'the list is drawn in a portal, outside the page');
  assert.equal(lastOption.z, '70');
  assert.ok(lastOption.inWindow, `the list stays inside the window (${lastOption.side} the field)`);
  assert.ok(lastOption.onTop, `nothing covers the last option, ${lastOption.label}`);
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('[role=listbox] [role=option]')];
    opts[opts.length - 1].click();
  });
  await page.waitFor((want) => [...document.querySelectorAll('input[role=combobox]')].some((i) => i.value === want), [lastOption.label], { what: 'the last option chosen' });
  await page.setViewport(...DESKTOP);
  await choose('Where this money comes from', 'Business revenue');
  await page.fill('Reference on their bank statement (optional)', 'PO-1201');
  await page.find('text', 'Fits your rules');
  await shot('transfer-amount');
  // Back from step 2 lands on step 1, and forward again keeps the amount.
  await page.click('button', 'Back to recipient');
  await page.find('heading', 'Who are you paying?');
  await page.click('button', 'Continue to amount');
  await page.find('heading', 'How much?');
  await page.waitFor(() => /₱75,000\.00/.test(document.querySelector('.iso-txhead__metrics')?.innerText ?? ''), [], { what: 'the amount kept' });
  await page.click('button', 'See routes and cost');
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  await page.find('text', /^Passed \d+ of \d+ rules/);
  await headerMatchesServer('quote', /^Draft$/);
  // Lanes say "Cheapest", "Fastest" or "Other route", never a network or a time. Each lane's small route
  // line runs You → (lower-cost lane) → Partner → bank, and coins move only on the picked one.
  const laneNames = (await page.text('.iso-lane__name')).map((t) => t.replace(/^·\s*/, '').trim());
  assert.ok(laneNames.length >= 1 && laneNames.every((n) => ['Cheapest', 'Fastest', 'Other route'].includes(n)), `lane names: ${laneNames}`);
  const mini = await page.evaluate(() => [...document.querySelectorAll('.iso-route')].map((r) => ({ on: r.getAttribute('aria-checked') === 'true', stops: [...r.querySelectorAll('.iso-mini__label')].map((x) => x.innerText.trim()), wires: r.querySelectorAll('.iso-mini__wire').length, moving: r.querySelectorAll('.iso-mini__wire--active').length })));
  assert.equal(mini.filter((m) => m.on).length, 1, 'one lane picked');
  for (const m of mini) {
    assert.equal(m.stops[0], 'You');
    assert.equal(m.wires, m.stops.length - 1, 'one link between each two stops');
    assert.equal(m.moving, m.on ? m.wires : 0, 'coins only on the picked lane');
  }
  assert.doesNotMatch((await page.text('main')).join('\n'), TIME_WORDS, 'no time or speed words on Transfer');
  await shot('transfer-quote');
  // "How it moves" (§5.6), opened: the one place on Step 3 that names how a route travels.
  await page.evaluate(() => [...document.querySelectorAll('summary')].find((s) => /How it moves/.test(s.innerText))?.click());
  await page.sleep(300);
  await shotOne('transfer-how-it-moves', 'desktop');
  await page.evaluate(() => [...document.querySelectorAll('summary')].find((s) => /How it moves/.test(s.innerText))?.click());
  // The floating Zeke on Transfer (§3.5): it knows where it is, and it has no approve control.
  await page.click('button', 'Open Zeke');
  await page.find('text', /Looking at:\s*Transfer/);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.iso-zk__panel button')].filter((b) => /approve/i.test(b.textContent)).length), 0, 'no approve button in the floating panel');
  await shot('zeke-open-transfer');
  await page.click('button', 'Close Zeke');
  // Back from step 3 lands on step 2 with the same amount; forward again quotes afresh.
  await page.click('button', 'Back to amount');
  await page.find('heading', 'How much?');
  await page.waitFor(() => /₱75,000\.00/.test(document.querySelector('.iso-txhead__metrics')?.innerText ?? ''), [], { what: 'the amount kept on the way back' });
  await page.click('button', 'See routes and cost');
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  await page.find('button', 'Review and approve', { enabled: true, timeoutMs: 60_000 });
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this payment');
  // The approval (prompt 11 §2.3): its own step, full width, no So far rail; focus on the step's
  // heading; no way back from here (the header has no links, and there is no back link).
  await page.waitFor(() => /step=approve/.test(location.search), [], { what: 'step 4 in the URL' });
  await headerMatchesServer('approve', /^Waiting for you$/);
  assert.ok(await page.evaluate(() => document.activeElement?.id === 't4-title'), 'focus is on the step heading');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.iso-sofar, .iso-sofar__back').length), 0, 'no So far rail and no back link on Approve');
  const card = (await page.text('.iso-approve')).join('\n');
  assert.match(card, /Prepared by .+\. Zeke can’t approve; only you can\./);
  assert.match(card, /Checked by call-back/);
  assert.match(card, /PO-1201/);
  assert.match(card, /Purchase of goods: Pallets and stretch film/);
  assert.match(card, /(\d+) of \1 pass/);
  // The approve button is the only coral on the page's content (the header's current step aside).
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.iso-tx, .iso-approve')].flatMap((r) => [...r.querySelectorAll('.iso-btn--approve')]).length), 1);
  await shot('transfer-approve');
  await approveThenTrack();
  await shot('transfer-approved');
  await page.find('heading', 'Paid, with proof recorded', { timeoutMs: 60_000 });
  await page.find('text', /^Proof recorded\./, { timeoutMs: 60_000 });
  await headerMatchesServer('track', /^Paid$/);
  await page.click('button', 'Verify receipt');
  await page.find('text', /^This receipt verifies\. It matches the proof recorded for it\./);
  assert.doesNotMatch((await page.text('main')).join('\n'), TIME_WORDS, 'no time or speed words on the track step');
  await shot('transfer-track-paid');
  await page.click('button', 'Save as template');
  await page.find('button', 'Saved as a template');

  // Batch: twelve suppliers, quoted in chunks, one approval, paid chunk by chunk.
  await page.goto(`${BASE}/dashboard/batch`);
  await page.find('button', 'Quote the sample batch');
  await shot('batch-start');
  await page.click('button', 'Quote the sample batch');
  await page.find('heading', /^12 suppliers in \d+ chunks?$/i);
  await shot('batch-review');
  await page.click('button', /^Approve (the batch|all \d+ chunks) with this device$/i);
  await page.find('heading', /^12 of 12 suppliers paid$/i, { timeoutMs: 90_000 });
  await shot('batch-paid');

  // Zeke, history, rules, and the overview with everything in it.
  await page.goto(`${BASE}/dashboard/zeke`);
  await page.find('heading', 'What each part of Zeke does');
  await shot('zeke');
  await page.goto(`${BASE}/dashboard/history`);
  await page.waitFor(() => document.querySelectorAll('.sx-table tbody tr').length >= 1, [], { what: 'the payment row' });
  await shot('history');
  await page.goto(`${BASE}/dashboard/settings/policy`);
  await page.waitIdle();
  await shot('policy');
  await page.goto(`${BASE}/dashboard`);
  await page.find('heading', 'Your money, all accounts');
  await page.waitFor(() => document.querySelectorAll('.iso-table tbody tr').length >= 1, [], { what: 'recent payments on the overview' });
  const ov = (await page.text('main')).join('\n');
  assert.match(ov, /Paid · proof recorded/);
  assert.match(ov, /Payments this month/);
  assert.match(ov, /Where you can pay/);
  assert.match(ov, /Checks and limits/);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.iso-extrude')].filter((e) => e.getClientRects().length).length), 1, 'one extruded number');
  assert.equal(await page.evaluate(() => document.querySelectorAll('[aria-label="Payments this month, by where they are"] .iso-station').length), 6, 'six stations in the pipeline');
  await shot('overview');

  // A second invoice, clicked through on a phone: pasted, checked (its bank details are known now: the
  // first invoice's payment saved them, so no call-back), and paid through Transfer.
  await page.setViewport(...PHONE);
  await page.goto(`${BASE}/dashboard/invoices/pay`);
  await page.click('button', 'Paste text');
  await page.fill(
    'The invoice’s text',
    'MANILA FREIGHT SERVICES INC.\nInvoice No: INV-0413\nDue Date: 2026-10-30\nAmount Due: PHP 120,000.00\nBeneficiary: Manila Freight Services Inc.\nBank: BDO Unibank, Inc.\nAccount Number: 0021-8830-4471\n',
  );
  await page.click('button', 'Read this invoice');
  await page.find('heading', 'Check the invoice', { timeoutMs: 30_000 });
  await page.find('heading', 'Zeke’s draft');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.iso-callout').length), 0, 'known bank details: no call-back panel');
  assert.doesNotMatch((await page.text('main')).join('\n'), NO_FULL_NUMBER, 'pasted, and still masked');
  await page.evaluate(() => document.querySelectorAll('.iso-tickbtn[aria-label$=": mark as checked"]').forEach((b) => b.click()));
  await page.waitFor(() => document.querySelectorAll('.iso-tickbtn[aria-pressed="true"][aria-label$=": checked"]').length === 5, [], { what: 'five ticks on a phone' });
  await tap('Confirm and pay');
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  await headerMatchesServer('quote', /^Draft$/);
  // Prompt 11 §2.2: on a phone the main action is pinned to the bottom of the screen, and reachable.
  await page.find('button', 'Review and approve', { enabled: true, timeoutMs: 60_000 });
  const pinned = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.iso-sofar__cta button')].find((x) => /Review and approve/.test(x.innerText));
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const bar = b.closest('.iso-sofar__cta').getBoundingClientRect();
    return { fixed: getComputedStyle(b.closest('.iso-sofar__cta')).position, barBottom: Math.round(innerHeight - bar.bottom), inBar: r.top >= bar.top && r.bottom <= bar.bottom, onTop: b.contains(hit), zekeAbove: (() => { const z = document.querySelector('.iso.iso-zk'); return !z || z.getBoundingClientRect().bottom <= bar.top + 1; })() };
  });
  assert.equal(pinned.fixed, 'fixed', 'the main action is pinned on a phone');
  assert.equal(pinned.barBottom, 0, 'its bar sits on the bottom edge of the screen');
  assert.ok(pinned.inBar, 'the action is in that bar');
  assert.ok(pinned.onTop, 'nothing covers it');
  assert.ok(pinned.zekeAbove, 'the floating Zeke sits above the pinned bar');
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this payment');
  await approveThenTrack();
  await page.find('heading', /^(Paid to the bank|Paid, with proof recorded)$/, { timeoutMs: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `no sideways scroll at 390 px (${overflow}px over)`);
  await page.setViewport(...DESKTOP);

  // A business on Splash (prompt 10 §5.4): found in the directory, paid straight into its own Splash
  // account, in US dollars, with no Splash fee and no quote clock.
  await page.goto(`${BASE}/dashboard/transfer?to=splash`);
  await page.find('heading', 'Who are you paying?');
  await page.fill('Company name, Splash handle or registration number', '@kuchingmarine');
  await page.find('text', 'Kuching Marine Supply');
  await page.find('text', 'No payout fee');
  await shot('transfer-splash-find');
  // Double-click a business: picked, and straight on to the amount (prompt 11 §2.3).
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.iso-pick__main')].find((b) => /Kuching Marine Supply/.test(b.innerText));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  });
  await page.find('heading', 'How much?');
  assert.ok(await page.evaluate(() => /step=amount/.test(location.search)), 'a double-click lands on step 2');
  const hs = await header();
  assert.deepEqual([hs.title, hs.facts['Paid out by']], ['Pay Kuching Marine Supply', 'Inside Splash']);
  await page.fill('Amount', '1,500');
  await page.fill('Note', 'Spare parts, October');
  await page.find('text', 'Fits your rules');
  await shot('transfer-splash-amount');
  await page.click('button', 'See routes and cost');
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  await headerMatchesServer('quote', /^Draft$/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.iso-txhead .iso-ring, .iso-tx .iso-ring').length), 0, 'no quote clock: there is no rate to run out');
  assert.deepEqual((await page.text('.iso-lane__name')).map((t) => t.trim()), ['Inside Splash'], 'one lane');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.iso-route .iso-mini__wire').length), 1, 'two stops, one link');
  await page.find('text', 'No Splash fee between Splash businesses.');
  await shot('transfer-splash-quote');
  await page.find('button', 'Review and approve', { enabled: true, timeoutMs: 60_000 });
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this payment');
  await headerMatchesServer('approve', /^Waiting for you$/);
  assert.match((await page.text('.iso-approve')).join('\n'), /Into Kuching Marine Supply’s Splash account|Into Kuching Marine Supply's Splash account/);
  await approveThenTrack();
  await page.find('heading', /^(Paid into their Splash account|Paid, with proof recorded)$/, { timeoutMs: 60_000 });
  await page.find('text', 'In their account');
  await headerMatchesServer('track', /^Paid$/);
  await shot('transfer-splash-paid');

  // Pay again from the template, for more than the Payments account holds: the reserve covers what is
  // short, and that move lands first, in the same approval.
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.find('heading', 'Pay again');
  await page.click('button', /^Cebu Logistics/);
  await page.find('heading', 'How much?');
  await page.fill('They receive', '1,000,000');
  await page.waitFor(() => /PESONet/.test(document.querySelector('.iso-txhead__metrics')?.innerText ?? ''), [], { what: 'Paid out by PESONet in the header' });
  await page.click('button', 'See routes and cost');
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  await page.find('text', 'Moves first');
  await headerMatchesServer('quote', /^Draft$/);
  await shot('transfer-reserve-plan');
  await page.find('button', 'Review and approve', { enabled: true, timeoutMs: 60_000 });
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this payment');
  assert.match((await page.text('.iso-approve')).join('\n'), /moves from your reserve first/);
  await approveThenTrack(90_000);
  await page.find('heading', /^(Paid to the bank|Paid, with proof recorded)$/, { timeoutMs: 60_000 });
  await shot('transfer-reserve-paid');

  // The bank path with the keyboard only (prompt 10 §5.9): no clicks from Step 1 to the receipt.
  const focused = (test) => new Function(`const el = document.activeElement; return !!el && (${test});`);
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.find('heading', 'Who are you paying?');
  // A recipient row is a radio: Enter picks it, Enter on the picked row goes on (prompt 11 §2.3).
  await page.tabTo(focused("el.getAttribute('role') === 'radio' && /Cebu Logistics Inc\\./.test(el.innerText)"), { what: 'the Cebu Logistics Inc. row' });
  await page.press('Enter');
  await page.waitFor(() => document.getElementById('tx-title')?.innerText.trim() === 'Pay Cebu Logistics Inc.', [], { what: 'the row picked' });
  await page.press('Enter');
  await page.find('heading', 'How much?');
  // The step's heading has the focus on arrival.
  assert.ok(await page.evaluate(() => document.activeElement?.hasAttribute('data-step-heading')), 'focus on the step heading');
  await page.tabTo(focused("el.id && document.querySelector('label[for=\"' + el.id + '\"]')?.innerText.trim() === 'They receive'"), { what: 'They receive' });
  await page.type('20,000');
  await page.waitFor(() => /InstaPay/.test(document.querySelector('.iso-txhead__metrics')?.innerText ?? ''), [], { what: 'Paid out by InstaPay in the header' });
  // A button, not anything whose text contains the words: the page itself does, when it has the focus.
  await page.tabTo(focused("el.tagName === 'BUTTON' && /See routes and cost/.test(el.innerText)"), { what: 'See routes and cost' });
  await page.press('Enter');
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  // Step 3 first works out where the money comes from (here, a move from the reserve); the button is
  // ready once the reason under it is gone. A key pressed before that would land on nothing.
  await page.waitFor(() => !document.querySelector('.iso-sofar__cta .iso-btn-why') && [...document.querySelectorAll('.iso-sofar__cta button')].some((b) => /Review and approve/.test(b.innerText) && !b.disabled), [], { what: 'Review and approve to be ready' });
  await page.waitIdle({ quietMs: 500 });
  await page.tabTo(focused("el.tagName === 'BUTTON' && /Review and approve/.test(el.innerText)"), { what: 'Review and approve' });
  await page.press('Enter');
  await page.find('heading', 'Approve this payment');
  assert.ok(await page.evaluate(() => document.activeElement?.id === 't4-title'), 'focus starts on the step heading');
  await page.tabTo(focused("el.tagName === 'BUTTON' && /Approve on this device/.test(el.innerText)"), { what: 'Approve on this device' });
  await page.press('Enter');
  await page.waitFor(() => /step=track/.test(location.search), [], { what: 'Track to open by itself', timeoutMs: 60_000 });
  await page.find('heading', /^(On its way|Paid to the bank|Paid, with proof recorded)$/, { timeoutMs: 60_000 });

  // A failure, rehearsed in test mode: the bank returns the payment. One sentence, one thing to do.
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.click('button', /^Cebu Logistics/);
  await page.click('button', 'See routes and cost');
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  await page.evaluate(() => [...document.querySelectorAll('summary')].find((s) => /Rehearse a problem/.test(s.innerText))?.click());
  await tap('The bank returns it');
  await tap('Review and approve');
  await page.find('heading', 'Approve this payment');
  await approveThenTrack();
  await page.find('heading', 'The bank returned the payment to Cebu Logistics', { timeoutMs: 60_000 });
  await page.find('text', /^The bank returned it: what the partner received comes back to your Payments account/);
  await shot('transfer-returned');

  // And one stopped by a rule: screening flags the recipient, so the route can't be approved.
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.click('button', /^Cebu Logistics/);
  await page.click('button', 'See routes and cost');
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  await page.evaluate(() => [...document.querySelectorAll('summary')].find((s) => /Rehearse a problem/.test(s.innerText))?.click());
  await tap('Screening flags them');
  await tap('Review and approve');
  await page.waitFor(() => [...document.querySelectorAll('[role=alert]')].some((e) => e.innerText.trim().length > 0), [], { what: 'the rule that stopped it' });
  await shot('transfer-stopped-by-rule');

  // Balance (prompt 10 §5.10): add money with a bank or card top-up, then from a crypto wallet.
  await page.goto(`${BASE}/dashboard/fund`);
  await page.find('heading', 'Payments account');
  await page.find('heading', 'Money in and out');
  await shot('balance');
  await page.click('button', 'Top up');
  await page.find('heading', 'Add money');
  await page.fill('How much to add', '1,000');
  await choose('Where this money comes from', 'Business revenue');
  await page.check('I confirm this money belongs to the company and comes from where I said.');
  await shot('balance-top-up');
  await page.click('button', 'Add US$1,000.00');
  await page.find('text', 'Landed in your Payments account', { timeoutMs: 30_000 });
  await page.waitFor(() => [...document.querySelectorAll('.iso-fundsteps li')].every((li) => li.dataset.state === 'done'), [], { what: 'the top-up to land', timeoutMs: 30_000 });
  await page.click('button', 'Done');
  await page.click('button', 'Choose a wallet');
  await page.find('heading', 'Add money');
  await page.fill('How much to add', '500');
  await page.click('button', 'Use a test wallet');
  await choose('Where this money comes from', 'Owner’s capital');
  await page.check('I confirm this money belongs to the company and comes from where I said.');
  await shot('balance-crypto-wallet');
  await page.click('button', 'Approve US$500.00 in your wallet');
  await page.waitFor(() => [...document.querySelectorAll('.iso-fundsteps li')].every((li) => li.dataset.state === 'done'), [], { what: 'the wallet money to land', timeoutMs: 30_000 });
  await shot('balance-crypto-landed');
  await page.click('button', 'Done');

  // Settings › Account details: "Let other Splash businesses find us", off by default.
  await page.goto(`${BASE}/dashboard/settings/account`);
  await page.find('heading', 'Found on Splash');
  await page.find('text', 'Not listed');
  await shot('settings-found-on-splash');

  // Get paid (prompt 10 §6.3). First someone else: a link to a page with this company's own account,
  // paid in the simulator (test mode), matched by the reference and the exact amount.
  const ownAccount = await page.evaluate(async () => (await (await fetch('/api/solana/company')).json()).vault.vaultPda);
  await page.goto(`${BASE}/dashboard/invoices/get`);
  await page.find('heading', 'New request');
  await page.click('button', 'Someone else');
  await page.fill('Name', 'Batam Trade Partners');
  await page.fill('Email', 'accounts@example.com');
  await page.fill('Your invoice number', 'SEL-0096');
  await page.fill('Description', 'Hardwood pallets');
  await page.fill('Qty', '250');
  await page.fill('Unit price (US$)', '15');
  await page.waitFor(() => /US\$3,750\.00/.test(document.querySelector('.iso-reqpreview')?.innerText ?? ''), [], { what: 'the live preview' });
  assert.match((await page.text('.iso-reqpreview')).join('\n'), /asks Batam Trade Partners to pay/);
  await shot('get-paid-composer');
  await page.click('button', 'Send request');
  await page.find('heading', 'Request SEL-0096');
  const payLink = (await page.text('.iso-sheet .iso-paypage__acct code')).join('').trim();
  assert.match(payLink, /\/pay\/[A-Za-z0-9_-]{22}$/, 'a link with 128 random bits');
  await shot('get-paid-link');
  await page.press('Escape');
  await page.goto(payLink);
  await page.find('heading', /asks Batam Trade Partners to pay/);
  const payPage = (await page.text('main')).join('\n');
  assert.ok(payPage.includes(ownAccount), 'the page shows the requester’s own Payments account');
  assert.doesNotMatch(payPage, /CLIENT-USD-SETTLEMENT|Splash Labuan|MBBEMYKL/, 'never a Splash address');
  assert.doesNotMatch(payPage, /Pay by bank transfer/, 'hidden until a collection partner exists');
  assert.match(payPage, /SEL-0096/);
  await shot('pay-link');
  await page.click('button', 'Pay it in test mode');
  await page.find('text', 'Paid · thank you', { timeoutMs: 30_000 });
  await shot('pay-link-paid');
  await page.goto(`${BASE}/dashboard/invoices/get`);
  await page.waitFor(() => /SEL-0096[\s\S]*Paid · proof recorded/.test(document.querySelector('.iso-table')?.innerText ?? ''), [], { what: 'the request paid, with its proof' });
  await shot('get-paid-list');

  // Then a business on Splash. This company asks Kuching Marine Supply to pay, in the composer: the
  // request lands in Kuching's own inbox, ready to pay.
  await page.goto(`${BASE}/dashboard/invoices/get`);
  await page.find('heading', 'New request');
  await page.fill('Find the business on Splash', 'kuching');
  await page.click('button', 'Ask Kuching Marine Supply to pay');
  await page.find('text', 'It lands in their “Pay an invoice” inbox, ready to pay. No Splash fee between Splash businesses.');
  await page.fill('Your invoice number', 'SEL-0101');
  await page.fill('Description', 'Pallet wrap');
  await page.fill('Qty', '40');
  await page.fill('Unit price (US$)', '12.50');
  await page.waitFor(() => /US\$500\.00/.test(document.querySelector('.iso-reqpreview')?.innerText ?? ''), [], { what: 'the preview total' });
  assert.match((await page.text('.iso-reqpreview')).join('\n'), /Pay in Splash/);
  await shot('get-paid-splash-composer');
  await page.click('button', 'Send request');
  await page.find('heading', 'Request SEL-0101');
  await page.press('Escape');

  // And the other way, end to end: this company lists itself, Kuching asks it to pay, and it pays from
  // its own inbox, through Transfer, straight into Kuching's own account. The seeded Kuching account
  // has no approvers, so the dashboard keeps its people at device setup; its side runs through the
  // same API the pages call, signed in as Kuching.
  await page.goto(`${BASE}/dashboard/settings/account`);
  await page.find('heading', 'Found on Splash');
  await page.click('button', 'Listed');
  await page.click('button', 'Save');
  await page.find('text', /^Listed as @/);
  // Settings › Treasury: the reserve floor and stock limit read-only, the sweep rule the owner's.
  await page.find('heading', 'Treasury');
  await page.find('text', /^10% above what's due in the next 30 days$/);
  await page.find('text', /^At most 20% of treasury$/);
  const signInAs = async (who) => {
    // Read the answer to the end: a request left open would make every later wait for a quiet network time out.
    await page.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST' })).text());
    await page.goto(`${BASE}/login`);
    await page.fill('Business email', who);
    await page.fill('Password', DEMO_PASSWORD);
    await page.click('button', 'Sign in', { exact: true });
    await page.waitFor(() => location.pathname.startsWith('/dashboard'), [], { what: `${who} signed in` });
    await page.waitIdle();
  };
  const asApi = (route, init) => page.evaluate(async (r, i) => {
    const res = await fetch(`/api/solana${r}`, { ...(i ?? {}), headers: { 'content-type': 'application/json' } });
    return { status: res.status, body: await res.json() };
  }, route, init ?? null);
  await signInAs('peer@acme.test');
  const kuchingInbox = await asApi('/invoices');
  const fromAcme = kuchingInbox.body.rows.find((r) => r.number === 'SEL-0101');
  assert.ok(fromAcme, 'the request is in Kuching’s inbox');
  assert.deepEqual({ tab: fromAcme.tab, from: fromAcme.from, supplier: fromAcme.supplier, currency: fromAcme.amount.currency, minor: fromAcme.amount.minor }, { tab: 'ready', from: 'splash', supplier: 'Acme Manufacturing', currency: 'USD', minor: '500000000' });
  const asked = await asApi('/requests', { method: 'POST', body: JSON.stringify({ payer: { kind: 'splash', payerOrgId: 'demo-business' }, number: 'KMS-0094', dueDate: '2026-12-01', lines: [{ description: 'Mooring rope, 40 m', quantity: '3', unitMinor: '1150000000' }], note: 'October order', send: true }) });
  assert.equal(asked.status, 201, JSON.stringify(asked.body));
  assert.equal(asked.body.request.status.key, 'sent');

  await signInAs(email);
  await page.goto(`${BASE}/dashboard/invoices`);
  await page.waitFor(() => /1 ready to pay/.test(document.querySelector('.iso-chooser')?.innerText ?? ''), [], { what: 'the chooser’s live count' });
  await shot('invoices-chooser-counts');
  await page.goto(`${BASE}/dashboard/invoices/pay`);
  await page.waitFor(() => /Kuching Marine Supply[\s\S]*on Splash[\s\S]*KMS-0094[\s\S]*US\$3,450\.00/.test(document.querySelector('[role=tabpanel]')?.innerText ?? ''), [], { what: 'the request in the inbox, ready to pay' });
  assert.equal(await page.evaluate(() => document.querySelector('[role=tab][aria-selected="true"]')?.firstChild?.textContent), 'Ready to pay');
  await shot('invoices-ready-from-splash');
  // The floating Zeke on Invoices (§3.5): its context, and no approve control.
  await page.click('button', 'Open Zeke');
  await page.find('text', /Looking at:\s*Invoices · Pay an invoice/);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.iso-zk__panel button')].filter((b) => /approve/i.test(b.textContent)).length), 0, 'no approve button in the floating panel');
  await shot('zeke-open-invoices');
  await page.click('button', 'Close Zeke');
  await tap('Pay Kuching Marine Supply');
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  assert.match((await page.text('main')).join('\n'), /KMS-0094/);
  await headerMatchesServer('quote', /^Draft$/);
  await page.find('button', 'Review and approve', { enabled: true, timeoutMs: 60_000 });
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this payment');
  await approveThenTrack();
  await page.find('heading', 'Paid, with proof recorded', { timeoutMs: 60_000 });
  await page.find('text', /^Proof recorded\./, { timeoutMs: 60_000 });
  await shot('request-paid-in-app');

  await signInAs('peer@acme.test');
  const kuchingRequests = await asApi('/requests');
  const paidRequest = kuchingRequests.body.requests.find((r) => r.number === 'KMS-0094');
  assert.equal(paidRequest.status.label, 'Paid · proof recorded', 'Kuching sees its request paid');
  assert.equal(paidRequest.paidBy, 'splash');
  assert.match(paidRequest.receiptHref, /^\/dashboard\/receipts\/rcpt_[0-9a-f]{16}$/, 'with its own receipt');
  assert.ok(paidRequest.viewedAt, 'it was viewed when Acme’s inbox listed it');
  await signInAs(email);

  // Treasury's investments (prompt 10 Phase 5, test mode): Hold; the owner's one-time eligibility
  // confirmation; T-bills subscribed straight from Ondo (held 40 days) and on the market; redeemed on
  // the market and with Ondo by wire; a stock bought and sold; then sweep on, today's draft reviewed
  // and approved, and Hold again. Every order ends in the approval moment and leaves a receipt.
  const order = async ({ open, title, path, amount, approveTitle, sheetShot, approveShot }) => {
    await page.click('button', open, { exact: true });
    await page.find('heading', title);
    if (path) await page.click('button', path, { exact: true });
    if (amount) await page.fill('Amount', amount);
    await page.waitFor(() => /(test price)/.test(document.querySelector('.iso-sheet')?.innerText ?? '') && !document.querySelector('.iso-sheet [aria-busy="true"]'), [], { what: 'the order priced' });
    if (sheetShot) await shot(sheetShot);
    await page.click('button', 'Review and approve');
    await page.find('heading', approveTitle);
    if (approveShot) await shot(approveShot);
    await page.click('button', 'Approve on this device', { exact: true });
    await page.find('text', /^Approved by you\./, { timeoutMs: 60_000 });
  };
  const usdyCard = () => page.evaluate(() => document.querySelector('section[aria-labelledby="tr-usdy"]')?.innerText ?? '');
  /** The T-bill card's text, its closed "How it works" included. */
  const usdyText = () => page.evaluate(() => document.querySelector('section[aria-labelledby="tr-usdy"]')?.textContent ?? '');
  /** The Investments account's amount, in the three accounts at the top. */
  const invested = () => page.evaluate(() => [...document.querySelectorAll('.iso-treasury__hero .iso-station')].find((s) => /Investments/.test(s.innerText))?.querySelector('.iso-station__amount')?.innerText.trim() ?? null);
  await page.goto(`${BASE}/dashboard/treasury`);
  await page.find('heading', 'US T-bill pool');
  await page.find('text', 'Investments aren’t live until legal sign-off in Malaysia. Buttons work on test money.');
  await page.find('text', /^Idle cash stays in your Payments account\. Zeke won't draft sweeps\./);
  // Prompt 11 §4.1: All accounts; then the T-bill pool and stocks on the left, Hold or sweep and the
  // activity in the rail beside them; then Risk and rules.
  const sections = await page.evaluate(() => [...document.querySelectorAll('main h2')].map((h) => h.innerText.trim()).filter((t) => ['All accounts', 'US T-bill pool', 'US stocks and ETFs', 'Hold or sweep', 'Treasury activity', 'Risk and rules'].includes(t)));
  assert.deepEqual(sections, ['All accounts', 'US T-bill pool', 'US stocks and ETFs', 'Hold or sweep', 'Treasury activity', 'Risk and rules']);
  const cols = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    return { left: r('.iso-treasury__left')?.right ?? null, rail: r('.iso-treasury__rail')?.left ?? null, railWidth: r('.iso-treasury__rail')?.width ?? null };
  });
  assert.ok(cols.rail >= cols.left && Math.round(cols.railWidth) === 320, `the rail sits beside the cards, 320 px wide: ${JSON.stringify(cols)}`);
  assert.match(await usdyCard(), /USDY, issued by Ondo · held in your Investments account/);
  assert.match(await usdyCard(), /Rate 3\.75% a year · variable · set monthly by Ondo · as of 13 Oct 2026 · source/);
  assert.match(await usdyCard(), /Interest today · live estimate/);
  assert.match(await usdyText(), /Not a bank deposit; its value can fall\./);
  assert.match(await usdyText(), /Most businesses redeem once a quarter\./);
  assert.doesNotMatch(await usdyText(), /\b(?:Buy|Sell|Withdraw|yield|APR|APY|earn)\b/, 'the T-bill card never says buy, sell, withdraw or yield');
  assert.match((await page.text('section[aria-labelledby="tr-stocks"] .iso-note--gold')).join(' '), /^Bought through Treasurers, our stock partner\./);
  // Two extruded numbers (prompt 11 §4.2 asks for the T-bill pool's value as one): the total and the pool.
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.iso-extrude')].filter((e) => e.getClientRects().length).map((e) => e.closest('[aria-labelledby]')?.getAttribute('aria-labelledby'))), ['tr-total', 'tr-usdy']);
  await shot('treasury-hold');

  // More test money in the Reserve, so a subscription can go past what the market takes (US$75,000).
  await page.click('button', 'Move money between accounts');
  await page.click('button', 'Add test money to your Reserve');
  await page.waitFor(() => [...document.querySelectorAll('.iso-treasury__hero .iso-station__amount')].some((e) => /^US\$1\d\d,\d{3}\.\d\d$/.test(e.innerText.trim())), [], { what: 'more test money in the Reserve' });
  await page.press('Escape');
  // Subscribe US$80,000: past the market's 0.30% limit, so the planner sends it straight to Ondo (§7.2),
  // and the sheet says so; the units are held 40 days. The owner confirms eligibility once, in the sheet.
  await page.click('button', 'Subscribe', { exact: true });
  await page.find('heading', 'Subscribe to US Treasury bills');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.iso-sheet button')].some((b) => /Straight from Ondo|On the market/.test(b.innerText))), false, 'the planner picks a subscription’s path');
  await page.fill('Amount', '80,000');
  await page.find('text', 'Straight from Ondo · units held 40 days');
  await page.find('text', /^Straight from Ondo: on the market this order would move the price more than 0\.30%/);
  // Prompt 11 §4.2: the simulator books one price a day, rising from its anchor day (13 Oct 2026), so
  // the price on the sheet is the day's. The units are the amount at that price.
  const priced = await page.waitFor(() => /([\d,]+\.\d\d) units at US\$(\d+\.\d{4}) \(test price\)/.exec(document.querySelector('.iso-sheet')?.innerText ?? '')?.slice(1), [], { what: 'the units at the day’s price' });
  const [unitsShown, priceShown] = priced.map((x) => Number(x.replaceAll(',', '')));
  assert.ok(priceShown >= 1.124 && priceShown < 1.2, `the day's test price: ${priceShown}`);
  // The price is shown to 4 decimals, so the units agree with 80,000 / price to within that rounding.
  assert.ok(Math.abs(unitsShown - 80_000 / priceShown) <= (80_000 / priceShown) * 5e-5, `${unitsShown} units at US$${priceShown}`);
  await page.find('text', /^I confirm: no owner \(25% or more\), director or approver of Acme Manufacturing is a US person/);
  await page.waitFor(() => /The units land in|Units land in/.test(document.querySelector('.iso-sheet')?.innerText ?? ''), [], { what: 'the order priced' });
  assert.equal(await page.evaluate(() => document.querySelector('.iso-sheet .iso-btn--approve')?.disabled), true, 'the gate blocks until the owner confirms');
  await page.evaluate(() => document.querySelector('.iso-sheet .iso-check input')?.click());
  await shot('treasury-subscribe-sheet');
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this subscription');
  await page.find('text', 'Not a bank deposit; its value can fall.');
  await shot('treasury-approve');
  await page.click('button', 'Approve on this device', { exact: true });
  await page.find('text', /^Approved by you\. Settled in test mode\. The units are in your Investments account\./, { timeoutMs: 60_000 });
  await page.click('button', 'Done');
  await page.waitFor(() => /US\$80,000\.00 is in its 40-day hold until \d{1,2} [A-Z][a-z]{2}/.test(document.querySelector('section[aria-labelledby="tr-usdy"]')?.innerText ?? ''), [], { what: 'the hold and its release date' });
  // Everything held: nothing to redeem yet.
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby="tr-usdy"] button')].find((b) => b.innerText.trim() === 'Redeem')?.disabled), true, 'held units can’t be redeemed');
  // "Interest today" ticks every second while the tab is visible, and stops while it's hidden (§4.2).
  // It is aria-live off; the group's name is read on focus.
  const live = () => page.evaluate(() => document.querySelector('.iso-tbill__liveval')?.innerText.trim() ?? null);
  assert.equal(await page.evaluate(() => document.querySelector('.iso-tbill__liveval')?.getAttribute('aria-live')), 'off');
  assert.equal(await page.evaluate(() => document.querySelector('.iso-tbill__live')?.getAttribute('aria-label')), 'Interest today, a live estimate');
  const tick0 = await live();
  assert.match(tick0, /^\+US\$\d+\.\d{4}$/);
  await page.sleep(3500);
  const tick1 = await live();
  assert.notEqual(tick1, tick0, `it ticks: ${tick0} → ${tick1}`);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const paused0 = await live();
  await page.sleep(3500);
  assert.equal(await live(), paused0, 'a hidden tab stops it');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.sleep(3500);
  assert.notEqual(await live(), paused0, 'and it ticks again when the tab is back');

  // On the market: no hold. Then redeem part of it on the market (into Payments) and part with Ondo (by wire).
  await order({ open: 'Subscribe', title: 'Subscribe to US Treasury bills', amount: '2,000', approveTitle: 'Approve this subscription' });
  await page.click('link', 'See the receipt');
  await page.waitFor(() => /subscribed to US Treasury bills/.test(document.querySelector('main')?.innerText ?? ''), [], { what: 'the order’s receipt' });
  await page.find('text', 'On the market');
  await shot('treasury-receipt');
  await page.goto(`${BASE}/dashboard/treasury`);
  await page.find('heading', 'US T-bill pool');
  await order({ open: 'Redeem', title: 'Redeem US Treasury bills', path: 'On the market', amount: '1,000', approveTitle: 'Approve this redemption', sheetShot: 'treasury-redeem-sheet' });
  await page.find('text', /The money is in your Payments account\./);
  await page.click('button', 'Done');
  await page.click('button', 'Redeem', { exact: true });
  await page.find('heading', 'Redeem US Treasury bills');
  await page.click('button', 'With Ondo, by wire', { exact: true });
  await page.fill('Amount', '500');
  await page.find('text', 'Your company’s bank account, by wire, outside Splash');
  await page.find('text', /Redeeming with Ondo sends US dollars by bank wire to your company's bank account, outside Splash\. It doesn't land in your Payments account\./);
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this redemption');
  await page.click('button', 'Approve on this device', { exact: true });
  await page.find('text', /^Approved by you\. Settled in test mode\. Ondo sends US dollars by bank wire/, { timeoutMs: 60_000 });
  await page.click('button', 'Done');

  // A stock: bought within the 20% limit and the 0.30% price-moved limit, then partly sold.
  await order({ open: 'Buy S&P 500', title: 'Buy S&P 500', amount: '1,000', approveTitle: 'Approve this buy', sheetShot: 'treasury-buy-sheet' });
  await page.click('button', 'Done');
  await page.find('button', 'Sell S&P 500');
  await order({ open: 'Sell S&P 500', title: 'Sell S&P 500', amount: '400', approveTitle: 'Approve this sale' });
  await page.click('button', 'Done');
  // What's held (prompt 11 §4.1 has no Positions box): the T-bill card's units, and the stock's row,
  // which now offers "Buy more" and "Sell".
  await page.waitFor(() => /[\d,]+\.\d+ units/.test(document.querySelector('section[aria-labelledby="tr-usdy"]')?.innerText ?? ''), [], { what: 'the T-bill units' });
  await page.waitFor(() => [...document.querySelectorAll('section[aria-labelledby="tr-stocks"] tbody tr')].some((r) => /S&P 500/.test(r.innerText) && /^US\$[\d,]+\.\d\d$/.test(r.querySelector('[data-label="You hold (test)"]')?.innerText.trim() ?? '') && /Buy more/.test(r.innerText)), [], { what: 'the stock held' });
  await shot('treasury-holdings');

  // Sweep (prompt 11 §4.3): the owner turns it on; Zeke drafts today's move as a row; Overview's
  // Review opens it; "Approve" on the row opens the approval moment, and nothing moves before it; then
  // the row says "Approved on this device" and the activity "you approved"; Hold again.
  await page.click('button', 'Sweep', { exact: true });
  await page.find('text', /^When cash builds above your reserve and a US\$5,000\.00 cushion, Zeke drafts a move into the T-bill pool\. Nothing moves until you approve it\./);
  await page.find('text', /^Move US\$[\d,]+\.\d\d in$/);
  await page.find('text', 'Idle cash above reserve and cushion');
  await page.find('text', /^Zeke: I drafted a sweep of US\$[\d,]+\.\d\d into T-bills under your sweep rule\. Nothing moves until a person approves it\.$/);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.iso-draft[data-state="drafted"] button')].map((b) => [b.innerText.trim(), b.classList.contains('iso-btn--approve')])), [['Approve', true], ['Not now', false]]);
  await shot('treasury-sweep');
  // Overview with Investments above zero and the sweep draft in Needs you (§4.2, §7.3).
  await page.goto(`${BASE}/dashboard`);
  await page.find('heading', 'Your money, all accounts');
  await page.find('text', 'Treasury bills and stocks · test mode');
  if (!(await page.evaluate(() => /Sweep drafted · US\$/.test(document.querySelector('main')?.innerText ?? '')))) await page.click('button', /^See all \d+/);
  await page.find('text', /^Sweep drafted · US\$[\d,]+\.\d\d into T-bills$/);
  await shot('overview-investments-sweep');
  // Its Review opens the draft on Treasury, to read before approving.
  await page.evaluate(() => [...document.querySelectorAll('main li, main [role="listitem"], main .iso-need')].find((r) => /Sweep drafted · US\$/.test(r.innerText))?.querySelector('a')?.click());
  await page.waitFor(() => location.pathname === '/dashboard/treasury' && /sweep=/.test(location.search), [], { what: 'Treasury with the draft' });
  await page.find('heading', /^Sweep: subscribe US\$[\d,]+\.\d\d$/);
  await page.find('text', /^Drafted by Zeke from your sweep rule: keep the reserve at its floor and at least US\$5,000\.00 in Payments\. Your owner chose T-bills when turning sweep on; Zeke didn't\./);
  await shot('treasury-sweep-review');
  await page.press('Escape');
  await page.waitFor(() => !document.querySelector('.iso-sheet-root'), [], { what: 'the sheet closed' });
  // "Approve" on the row: the approval moment, and nothing has moved yet.
  const before = await invested();
  await page.evaluate(() => [...document.querySelectorAll('.iso-draft[data-state="drafted"]')].find((r) => /Move US\$/.test(r.innerText))?.querySelector('.iso-btn--approve')?.click());
  await page.find('heading', 'Approve this subscription', { timeoutMs: 60_000 });
  await page.find('text', /^Drafted by Zeke from your sweep rule/);
  assert.equal(await invested(), before, 'nothing moves until a person approves');
  await shot('treasury-sweep-approve');
  await page.click('button', 'Approve on this device', { exact: true });
  await page.find('text', /^Approved by you\./, { timeoutMs: 60_000 });
  await page.click('button', 'Done');
  await page.waitFor(() => /Approved on this device/.test(document.querySelector('section[aria-labelledby="tr-sweep"]')?.innerText ?? ''), [], { what: 'the row approved on this device' });
  assert.notEqual(await invested(), before, 'the move happened once approved');
  assert.match(await page.evaluate(() => document.querySelector('section[aria-labelledby="tr-activity"]')?.innerText ?? ''), /Moved in · you approved · Today/);
  await page.click('button', 'Hold', { exact: true });
  await page.find('text', /^Idle cash stays in your Payments account\. Zeke won't draft sweeps\./);
  // History's gold Treasury rows, one per settled order.
  await page.goto(`${BASE}/dashboard/history`);
  await page.find('heading', 'Treasury');
  assert.equal(await page.evaluate(() => document.querySelectorAll('section[aria-labelledby="history-treasury"] li').length), 7, 'seven settled orders');
  await shot('history-treasury');

  // A bill due this week, with its payment drafted: Kuching asks for US$100 due in three days, and Acme
  // opens it in Transfer (a draft, not approved). Zeke then finds it when asked (below).
  const dueSoon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await signInAs('peer@acme.test');
  const askedSoon = await asApi('/requests', { method: 'POST', body: JSON.stringify({ payer: { kind: 'splash', payerOrgId: 'demo-business' }, number: 'KMS-0101', dueDate: dueSoon, lines: [{ description: 'Shackles, galvanised', quantity: '4', unitMinor: '25000000' }], note: 'Due this week', send: true }) });
  assert.equal(askedSoon.status, 201, JSON.stringify(askedSoon.body));
  await signInAs(email);
  await page.goto(`${BASE}/dashboard/invoices/pay`);
  await page.waitFor(() => /KMS-0101/.test(document.querySelector('[role=tabpanel]')?.innerText ?? ''), [], { what: 'the new request in the inbox' });
  await tap('Pay Kuching Marine Supply');
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  assert.equal((await header()).facts['They receive'], 'US$100.00');
  const draftedFor = await page.evaluate(() => new URLSearchParams(location.search).get('payment'));
  assert.match(draftedFor ?? '', /^pay_[0-9a-f]{16}$/);

  // The Zeke page (prompt 10 §7A): the counters, "Waiting for you" and "Today" from server state, the
  // roster read from the code, and nothing on the page that approves. Asked "What's due this week?",
  // Zeke lists the bill, and its ticket opens the drafted payment on Transfer (§10).
  await page.goto(`${BASE}/dashboard/zeke`);
  await page.find('heading', 'What should we look at?');
  await page.waitFor(() => /Read (an invoice|\d+ invoices)/.test(document.querySelector('section[aria-labelledby="zk-log"]')?.innerText ?? ''), [], { what: 'Zeke’s log for today' });
  const zekeCounts = await page.evaluate(() => [...document.querySelectorAll('.iso-desk__count dd')].map((d) => d.innerText.trim()));
  assert.equal(zekeCounts.length, 3);
  assert.ok(zekeCounts.every((c) => /^\d+$/.test(c)), `the counters come from the server: ${zekeCounts.join(', ')}`);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /approve/i.test(b.innerText)).length), 0, 'no approve control on the Zeke page');
  assert.equal(await page.evaluate(() => document.querySelector('.iso-zk')), null, 'the floating Zeke steps aside');
  await page.find('text', 'It can only read and draft. It can’t approve a payment, move money or change a rule.');
  assert.equal(await page.evaluate(() => document.querySelectorAll('section[aria-labelledby="zk-team"] tbody tr').length), 7, 'every part of Zeke, from the code');
  await page.fill('Ask Zeke', 'What’s due this week?');
  await page.click('button', 'Send', { exact: true });
  await page.waitFor(() => /KMS-0101[\s\S]*already has a payment drafted/.test(document.querySelector('.iso-desk__thread')?.innerText ?? ''), [], { what: 'Zeke’s answer', timeoutMs: 60_000 });
  await page.find('text', 'Draft · not approved');
  await shot('zeke-page');
  await page.click('link', 'Open to review');
  await page.waitFor((id) => location.pathname === '/dashboard/transfer' && new URLSearchParams(location.search).get('payment') === id, [draftedFor], { what: 'Transfer, on the drafted payment' });
  await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
  assert.equal((await header()).title, 'Pay Kuching Marine Supply');

  // Secrets: nothing the page sent contains the recovery words.
  // 1. No request (URL, body, headers) carries the phrase, or any two neighbouring words of it.
  // 2. In every Solana API request body, no free-text value contains any single recovery word. Enum
  //    fields the app itself sends (role: "device" / "kit", method: "call-back", ...) are skipped,
  //    since some are BIP39 words by coincidence; invoice text is ordinary English and gets check 1.
  const phrase = words.map((w) => w.toLowerCase());
  const word = new RegExp(`\\b(${phrase.join('|')})\\b`, 'i');
  const ENUM_KEYS = new Set(['role', 'method', 'source', 'rehearsal', 'purpose', 'status', 'sample', 'from', 'step', 'sourceOfFunds', 'relationship', 'type', 'asset', 'kind', 'when', 'bankCode', 'path']);
  // What a person typed about a supplier, a recipient or a payer (invoice text, transfer details, a
  // request's lines, a call-back) is ordinary English: check 1 only.
  const INVOICE_TEXT_KEYS = new Set(['text', 'fields', 'csv', 'recipient', 'reference', 'verification', 'details', 'name', 'holderName', 'addressLine', 'city', 'registration', 'personId', 'note', 'check', 'by', 'payer', 'lines', 'spokeTo', 'numberCalled', 'number', 'myInvoisRef']);
  const strings = (v, key, out) => {
    if (typeof v === 'string') {
      if (!ENUM_KEYS.has(key) && !INVOICE_TEXT_KEYS.has(key)) out.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => strings(x, key, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!INVOICE_TEXT_KEYS.has(k)) strings(x, k, out);
    return out;
  };
  for (const r of page.requests) {
    if (r.url.startsWith('data:')) continue;
    const hay = `${r.url}\n${r.body}\n${r.headers}`.toLowerCase();
    assert.ok(!hay.includes(phrase.join(' ')), `request ${r.url} carries the phrase`);
    for (let i = 0; i + 1 < phrase.length; i++) {
      const pair = new RegExp(`\\b${phrase[i]}[^a-z]{1,4}${phrase[i + 1]}\\b`);
      assert.ok(!pair.test(hay), `request ${r.method} ${r.url} carries words ${i + 1} and ${i + 2}`);
    }
    if (r.url.includes('/api/solana/') && r.body) {
      let parsed = null;
      try {
        parsed = JSON.parse(r.body);
      } catch {
        parsed = null;
      }
      for (const v of parsed ? strings(parsed, '', []) : [r.body]) {
        const m = word.exec(v);
        assert.equal(m, null, `request ${r.method} ${r.url} carries recovery word "${m?.[0]}" in "${v.slice(0, 40)}"`);
      }
    }
  }
  const apiPosts = page.requests.filter((r) => r.method === 'POST' && r.url.includes('/api/solana/'));
  assert.ok(apiPosts.length >= 10, `the walkthrough exercised the API (${apiPosts.length} posts)`);
  const errors = page.errors.filter((e) => !/Failed to load resource|fonts\.g|webpack-hmr|_next\/webpack|Download the React DevTools/i.test(e));
  assert.deepEqual(errors, [], 'no page errors');

  // The staff console (prompt 07 §7): the six sections, over what this walkthrough just did.
  await page.goto(`${BASE}/admin/login`);
  await page.fill('Staff email', ADMIN.email);
  await page.fill('Password', ADMIN.password);
  await page.click('button', 'Enter staff console');
  await page.waitFor(() => location.pathname === '/admin' || location.pathname === '/admin/', [], { what: 'the staff console' });
  // A webhook with a forged signature, so the webhooks section shows a refusal next to the real ones.
  const forged = await page.evaluate(async () => {
    const res = await fetch('/api/solana/partner/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partnerId: 'mock-partner', paymentId: 'pay_0123456789abcdef', status: 'paid', amountPhpMinor: '100', at: new Date().toISOString(), signature: '0'.repeat(64) }),
    });
    return res.status;
  });
  assert.equal(forged, 401, 'a forged webhook is refused');
  await page.goto(`${BASE}/admin/orgs`);
  await page.find('heading', 'Orgs and vaults');
  assert.match((await page.text('table')).join('\n'), /none/, 'the config authority reads none, from the chain');
  await shot('admin-orgs');
  await page.goto(`${BASE}/admin/payments`);
  await page.find('heading', 'Payments');
  await shot('admin-payments');
  await page.goto(`${BASE}/admin/fee-payer`);
  await page.find('heading', 'Fee payer (Kora)');
  await shot('admin-fee-payer');
  await page.goto(`${BASE}/admin/evidence`);
  await page.find('heading', 'Evidence');
  await shot('admin-evidence');
  await page.goto(`${BASE}/admin/webhooks`);
  await page.find('heading', 'Partner webhooks');
  assert.match((await page.text('table')).join('\n'), /refused/, 'the forged webhook is in the log');
  await shot('admin-webhooks');
  await page.goto(`${BASE}/admin/compliance`);
  await page.find('heading', 'Refuse service');
  // Type only once React owns the form: a value set before hydration never reaches its state, and the
  // Suspend button stays disabled (seen once a second company, Kuching, is listed first).
  await page.waitFor(() => [...document.querySelectorAll('textarea')].every((t) => Object.keys(t).some((k) => k.startsWith('__reactProps'))) && document.querySelectorAll('textarea').length > 0, [], { what: 'the compliance form hydrated' });
  await page.fill('Reason for the audit log', 'KYB documents expired (walkthrough)');
  await page.click('button', /^Suspend /);
  await page.waitFor(() => [...document.querySelectorAll('table td')].some((td) => td.innerText.includes('KYB documents expired (walkthrough)')), [], { what: 'the suspension in the audit log' });
  await shot('admin-compliance');
  await page.fill('Reason for the audit log', 'Restored after the walkthrough');
  await page.click('button', /^Restore service for /);
  await page.waitFor(() => [...document.querySelectorAll('table td')].some((td) => td.innerText.includes('Restored after the walkthrough')), [], { what: 'the restore in the audit log' });

  // Diagnostics: a request the browser never reported finished makes every later wait time out.
  if (page.stuck.length) console.log(`[walk] requests never finished: ${JSON.stringify([...new Set(page.stuck)].slice(0, 8))}`);
  return { requests: page.requests.length, apiPosts: apiPosts.length, shots: n };
}

const skip = (!chrome && 'no Chrome, Edge or Chromium found (set CHROME_PATH)') || (!DEMO_PASSWORD && 'no seeded demo password in scripts/dev-db.mjs');

test('dashboard, 1440 px and 390 px: setup to verified receipt, a paid batch, a phone payment; recovery words never sent', { skip, timeout: 1_200_000 }, async () => {
  const r = await walk('demo@acme.test');
  assert.ok(r.shots >= 20, `${r.shots} screenshots per width`);
});
