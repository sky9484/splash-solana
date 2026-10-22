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
    await page.find('button', name);
    await page.waitFor(() => {
      const el = document.querySelector('[data-e2e-hit]');
      return el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    }, [], { what: `button "${name}" to be enabled` });
    await page.evaluate(() => {
      const el = document.querySelector('[data-e2e-hit]');
      el.removeAttribute('data-e2e-hit');
      el.click();
    });
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
  await page.find('heading', 'A key for this device, and your vault');
  await shot('device-key');
  await page.click('button', 'Create the key and the vault');
  await page.find('heading', 'Your vault is ready', { timeoutMs: 60_000 });
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

  // Treasury: operating cash in vault #1, then a move that funds the payments vault (#0).
  await page.goto(`${BASE}/dashboard/treasury`);
  await page.click('button', 'Add 100,000 test USDC (simulated)');
  await page.find('text', /US\$100,000\.00/);
  await shot('treasury-funded');
  await page.fill('Amount (USDC)', '30,000');
  await page.click('button', 'Move with this device', { exact: true });
  await page.find('text', 'Moved US$30,000.00 to your payments vault.', { timeoutMs: 60_000 });
  await page.waitFor(() => document.querySelectorAll('section[aria-labelledby="moves-title"] li').length >= 1, [], { what: 'the move in the list' });
  await shot('treasury-moved');
  await page.goto(`${BASE}/dashboard/fund`);
  await page.find('text', /US\$30,000\.00/);
  await shot('balance-funded');

  // An invoice round the loop: start → check → route → approve → progress → done.
  await page.goto(`${BASE}/dashboard/invoices`);
  await page.find('heading', 'The invoice loop');
  await page.find('button', 'Use the sample invoice');
  await shot('invoices-start');
  await page.click('button', 'Use the sample invoice');
  await page.find('heading', 'Zeke’s draft');
  await shot('check-invoice');
  await page.click('button', 'Mark verified');
  await page.find('heading', 'Bank details verified');
  await page.evaluate(() => document.querySelectorAll('.sx-tick input[type=checkbox]').forEach((b) => b.checked || b.click()));
  await shot('check-invoice-confirmed');
  await page.click('button', 'Confirm and compare routes');
  await page.waitFor(() => document.querySelectorAll('.sx-route').length >= 2, [], { what: 'route cards' });
  const cards = await page.text('.sx-route');
  assert.ok(cards.length >= 2 && cards.length <= 3, `2-3 route cards, got ${cards.length}`);
  assert.ok(cards.some((c) => c.includes('Splash pays the network fee')), 'the route straight to the partner says who pays the network fee');
  await shot('choose-route');
  await page.click('button', /^Review /);
  await page.waitFor(() => !!document.querySelector('.sx-approve'), [], { what: 'the approval card' });
  // The payment now waits for approval: Zeke's one nudge and the Overview badge, from the server's count.
  await page.waitFor(() => /1 draft needs your approval/.test(document.querySelector('.iso-zk__nudge')?.textContent ?? ''), [], { what: "Zeke's nudge" });
  assert.equal(await page.evaluate(() => document.querySelector('a.iso-navitem[href="/dashboard"] .iso-navbadge')?.textContent.trim()), '1');
  await shotOne('zeke-nudge', 'desktop');
  const approve = (await page.text('.sx-approve')).join('\n');
  assert.match(approve, /₱560,000\.00/);
  assert.match(approve, /Manila Freight Services Inc\./);
  await shot('approve-card');
  await page.click('button', 'Approve with this device');
  await page.find('heading', /^Paid\. /, { timeoutMs: 60_000 });
  await shot('done-evidence');

  // Receipt: verify, trace on Solscan, then tamper.
  await page.click('link', 'Open receipt');
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

  // The invoice now sits on the loop with its proof.
  await page.goto(`${BASE}/dashboard/invoices`);
  await page.waitFor(() => document.querySelectorAll('.sx-inbox li').length >= 1, [], { what: 'the invoice in the inbox' });
  assert.match((await page.text('.sx-inbox li')).join('\n'), /INV-0412/);
  await shot('invoices-loop');

  // Transfer (prompt 10 Phase 3): Recipient, Amount, Quote & send, Approve, Track. A new bank
  // recipient (the full number typed twice, checked by call-back), then the amount, the route, the
  // approval moment and the map driven by the payment's real state, to a verified receipt.
  const TIME_WORDS = /\b(\d+\s*(?:s|sec|seconds?|min|minutes?|hours?|days?)\b|same day|arrives? by|instant(?:ly)?|in minutes|faster)/i;
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.find('heading', 'Who are you paying?');
  await page.find('text', 'Manila Freight Services Inc.');
  await shot('transfer-recipient');
  await page.click('button', 'Add a new recipient');
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

  await page.click('button', 'Continue');
  await page.find('heading', 'How much does Cebu Logistics get?');
  await page.fill('They receive', '75,000');
  await page.find('text', 'Paid out by PESONet');
  await page.fill('What was bought', 'Pallets and stretch film');
  await choose('How you know them', 'Supplier');
  await choose('Where this money comes from', 'Business revenue');
  await page.fill('Reference on their bank statement (optional)', 'PO-1201');
  await page.find('text', 'This payment fits your limits');
  await shot('transfer-amount');
  await page.click('button', 'See routes and cost');
  await page.find('heading', 'How ₱75,000 reaches Cebu Logistics', { timeoutMs: 60_000 });
  await page.find('text', /^Passed \d+ of \d+ rules/);
  // Lanes say "Cheapest" and "Fastest" only, never a network or a time; the map draws stepCount links.
  const laneNames = (await page.text('.iso-lane__name')).map((t) => t.replace(/^·\s*/, '').trim());
  assert.ok(laneNames.length >= 1 && laneNames.every((n) => n === 'Cheapest' || n === 'Fastest'), `lane names: ${laneNames}`);
  const chosenSteps = Number(/(\d) steps/.exec((await page.text('.iso-lane[aria-checked="true"] .iso-lane__sub')).join(''))?.[1]);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.iso-routemap .iso-wire').length), chosenSteps, 'one link on the map per step');
  assert.doesNotMatch((await page.text('main')).join('\n'), TIME_WORDS, 'no time or speed words on Transfer');
  await shot('transfer-quote');
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this payment');
  // The approval moment: the page behind is inert, focus is in the card, and Esc goes back.
  assert.ok(await page.evaluate(() => !!document.querySelector('.iso-page--transfer [inert]')), 'the page behind is inert');
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('.iso-modal')), 'focus is in the card');
  await page.press('Escape');
  await page.waitFor(() => !document.querySelector('.iso-modal-root'), [], { what: 'Esc to cancel the approval moment' });
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this payment');
  const card = (await page.text('.iso-modal')).join('\n');
  assert.match(card, /Prepared by .+ · a person approves/);
  assert.match(card, /Checked by call-back/);
  assert.match(card, /PO-1201/);
  assert.match(card, /Purchase of goods: Pallets and stretch film/);
  assert.match(card, /Rules checked: (\d+) of \1/);
  await shot('transfer-approve');
  await page.click('button', 'Approve on this device');
  await page.find('text', /^Approved by you\./, { timeoutMs: 60_000 });
  await shot('transfer-approved');
  await page.click('button', 'Track it');
  await page.find('heading', 'Cebu Logistics has been paid', { timeoutMs: 60_000 });
  await page.find('text', /^Proof recorded\./, { timeoutMs: 60_000 });
  await page.click('button', 'Verify this receipt');
  await page.find('text', /^Verified\. This record matches the proof recorded for it\./);
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
  await page.find('heading', 'Zeke’s agents');
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

  // A second invoice, clicked through on a phone from start to paid.
  await page.setViewport(...PHONE);
  await page.goto(`${BASE}/dashboard/invoices`);
  await page.fill(
    'Invoice text',
    'MANILA FREIGHT SERVICES INC.\nInvoice No: INV-0413\nDue Date: 2026-10-30\nAmount Due: PHP 120,000.00\nBeneficiary: Manila Freight Services Inc.\nBank: BDO Unibank, Inc.\nAccount Number: 0021-8830-4471\n',
  );
  await page.click('button', 'Read this invoice');
  await page.find('heading', 'Zeke’s draft');
  await page.evaluate(() => document.querySelectorAll('.sx-tick input[type=checkbox]').forEach((b) => b.checked || b.click()));
  await page.click('button', 'Confirm and compare routes');
  await page.waitFor(() => document.querySelectorAll('.sx-route').length >= 2, [], { what: 'route cards on a phone' });
  await page.click('button', /^Review /);
  await page.click('button', 'Approve with this device');
  await page.find('heading', /^Paid\. Manila Freight Services Inc\. received ₱120,000\.00/, { timeoutMs: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `no sideways scroll at 390 px (${overflow}px over)`);
  await page.setViewport(...DESKTOP);

  // A business on Splash (prompt 10 §5.4): found in the directory, paid straight into its own Splash
  // account, in US dollars, with no Splash fee and no quote clock.
  await page.goto(`${BASE}/dashboard/transfer?to=splash`);
  await page.find('heading', 'Find a business on Splash');
  await page.fill('Company name, Splash handle or registration number', '@kuchingmarine');
  await page.find('text', 'Kuching Marine Supply');
  await page.find('text', 'Verified company');
  await shot('transfer-splash-find');
  await page.click('button', 'Pay Kuching Marine Supply');
  await page.find('heading', 'How much are you sending Kuching Marine Supply?');
  await page.fill('Amount', '1,500');
  await page.fill('Note', 'Spare parts, October');
  await page.find('text', 'This payment fits your limits');
  await shot('transfer-splash-amount');
  await page.click('button', 'See the cost');
  await page.find('heading', 'How US$1,500 reaches Kuching Marine Supply', { timeoutMs: 60_000 });
  assert.equal(await page.evaluate(() => document.querySelectorAll('.iso-pagehead .iso-ring').length), 0, 'no quote clock: there is no rate to run out');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.iso-routemap .iso-wire').length), 1, 'two stations, one link');
  await page.find('text', 'No Splash fee between Splash businesses.');
  await shot('transfer-splash-quote');
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this payment');
  assert.match((await page.text('.iso-modal')).join('\n'), /Into Kuching Marine Supply’s Splash account|Into Kuching Marine Supply's Splash account/);
  await page.click('button', 'Approve on this device');
  await page.find('text', /^Approved by you\./, { timeoutMs: 60_000 });
  await page.click('button', 'Track it');
  await page.find('heading', 'Kuching Marine Supply has been paid', { timeoutMs: 60_000 });
  await page.find('text', 'In their account');
  await shot('transfer-splash-paid');

  // Pay again from the template, for more than the Payments account holds: the reserve covers what is
  // short, and that move lands first, in the same approval.
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.find('heading', 'Pay again');
  await page.click('button', /^Cebu Logistics/);
  await page.find('heading', 'How much does Cebu Logistics get?');
  await page.fill('They receive', '1,000,000');
  await page.find('text', 'Paid out by PESONet');
  await page.click('button', 'See routes and cost');
  await page.find('heading', 'How ₱1,000,000 reaches Cebu Logistics', { timeoutMs: 60_000 });
  await page.find('text', 'Moves first');
  await shot('transfer-reserve-plan');
  await page.click('button', 'Review and approve');
  await page.find('heading', 'Approve this payment');
  assert.match((await page.text('.iso-modal')).join('\n'), /moves from your reserve first/);
  await page.click('button', 'Approve on this device');
  await page.find('text', /^Approved by you\./, { timeoutMs: 90_000 });
  await page.click('button', 'Track it');
  await page.find('heading', 'Cebu Logistics has been paid', { timeoutMs: 60_000 });
  await shot('transfer-reserve-paid');

  // The bank path with the keyboard only (prompt 10 §5.9): no clicks from Step 1 to the receipt.
  const focused = (test) => new Function(`const el = document.activeElement; return !!el && (${test});`);
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.find('heading', 'Who are you paying?');
  await page.tabTo(focused("el.getAttribute('aria-label') === 'Pay Cebu Logistics Inc.'"), { what: 'Pay Cebu Logistics Inc.' });
  await page.press('Enter');
  await page.find('heading', 'How much does Cebu Logistics get?');
  await page.tabTo(focused("el.id && document.querySelector('label[for=\"' + el.id + '\"]')?.innerText.trim() === 'They receive'"), { what: 'They receive' });
  await page.type('20,000');
  await page.find('text', 'Paid out by InstaPay');
  await page.tabTo(focused("/See routes and cost/.test(el.innerText)"), { what: 'See routes and cost' });
  await page.press('Enter');
  await page.find('heading', 'How ₱20,000 reaches Cebu Logistics', { timeoutMs: 60_000 });
  await page.tabTo(focused("/Review and approve/.test(el.innerText)"), { what: 'Review and approve' });
  await page.press('Enter');
  await page.find('heading', 'Approve this payment');
  assert.ok(await page.evaluate(() => /Approve on this device/.test(document.activeElement?.innerText ?? '')), 'focus starts on the approve button');
  await page.press('Enter');
  await page.find('text', /^Approved by you\./, { timeoutMs: 60_000 });
  await page.waitFor(() => /Track it/.test(document.activeElement?.innerText ?? ''), [], { what: 'focus on Track it' });
  await page.press('Enter');
  await page.find('heading', 'Cebu Logistics has been paid', { timeoutMs: 60_000 });

  // A failure, rehearsed in test mode: the bank returns the payment. One sentence, one thing to do.
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.click('button', /^Cebu Logistics/);
  await page.click('button', 'See routes and cost');
  await page.find('heading', 'How ₱75,000 reaches Cebu Logistics', { timeoutMs: 60_000 });
  await page.evaluate(() => [...document.querySelectorAll('summary')].find((s) => /Rehearse a problem/.test(s.innerText))?.click());
  await tap('The bank returns it');
  await tap('Review and approve');
  await page.click('button', 'Approve on this device');
  await page.find('text', /^Approved by you\./, { timeoutMs: 60_000 });
  await page.click('button', 'Track it');
  await page.find('heading', 'The bank returned the payment to Cebu Logistics', { timeoutMs: 60_000 });
  await page.find('text', /^The bank returned it: the money comes back to your Payments account/);
  await shot('transfer-returned');

  // And one stopped by a rule: screening flags the recipient, so the route can't be approved.
  await page.goto(`${BASE}/dashboard/transfer`);
  await page.click('button', /^Cebu Logistics/);
  await page.click('button', 'See routes and cost');
  await page.find('heading', 'How ₱75,000 reaches Cebu Logistics', { timeoutMs: 60_000 });
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

  // Secrets: nothing the page sent contains the recovery words.
  // 1. No request (URL, body, headers) carries the phrase, or any two neighbouring words of it.
  // 2. In every Solana API request body, no free-text value contains any single recovery word. Enum
  //    fields the app itself sends (role: "device" / "kit", method: "call-back", ...) are skipped,
  //    since some are BIP39 words by coincidence; invoice text is ordinary English and gets check 1.
  const phrase = words.map((w) => w.toLowerCase());
  const word = new RegExp(`\\b(${phrase.join('|')})\\b`, 'i');
  const ENUM_KEYS = new Set(['role', 'method', 'source', 'rehearsal', 'purpose', 'status', 'sample', 'from', 'step', 'sourceOfFunds', 'relationship', 'type', 'asset', 'kind', 'when', 'bankCode']);
  // What a person typed about a supplier or recipient (invoice text, transfer details) is ordinary English: check 1 only.
  const INVOICE_TEXT_KEYS = new Set(['text', 'fields', 'csv', 'recipient', 'reference', 'verification', 'details', 'name', 'holderName', 'addressLine', 'city', 'registration', 'personId', 'note', 'check', 'by']);
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

test('dashboard, 1440 px and 390 px: setup to verified receipt, a paid batch, a phone payment; recovery words never sent', { skip, timeout: 900_000 }, async () => {
  const r = await walk('demo@acme.test');
  assert.ok(r.shots >= 20, `${r.shots} screenshots per width`);
});
