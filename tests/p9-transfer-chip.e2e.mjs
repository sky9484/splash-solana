// Prompt 11 §2.3, checked in Chrome: Transfer's Step 2 offers "Use invoice …" for a checked invoice to
// the picked recipient (the invoice prints "BDO Unibank, Inc.", the saved recipient says "BDO Unibank":
// matched by bank code), and the chip opens that invoice's own payment on Step 3, not a second one.
//
// Run on a fresh dev database (it sets the demo company up, reads the sample invoice and adds a
// recipient), with the dev server on BASE_URL:
//   BASE_URL=http://localhost:3200 node --test tests/p9-transfer-chip.e2e.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { findChrome, launch } from './helpers/cdp-browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const DEMO_PASSWORD = /const DEMO_PASSWORD = '([^']+)'/.exec(readFileSync('scripts/dev-db.mjs', 'utf8'))?.[1];

const skip = (!findChrome() && 'no Chrome, Edge or Chromium found (set CHROME_PATH)') || (!DEMO_PASSWORD && 'no seeded demo password in scripts/dev-db.mjs');

test('prompt 11 §2.3: Step 2 offers this recipient’s checked invoice, and the chip opens its own payment', { skip, timeout: 600_000 }, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ width: 1440, height: 900 });
    /** The app's own API, as the signed-in page: GET without a body, POST with one. */
    const call = (p, body) =>
      page.evaluate(
        async (path, bd) => {
          const r = await fetch(`/api/solana${path}`, bd == null ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bd) });
          return { status: r.status, json: await r.json().catch(() => null) };
        },
        p,
        body ?? null,
      );

    await page.goto(`${BASE}/login`);
    await page.fill('Business email', 'demo@acme.test');
    await page.fill('Password', DEMO_PASSWORD);
    await page.click('button', 'Sign in', { exact: true });
    await page.waitFor(() => location.pathname.startsWith('/dashboard'), [], { what: 'the dashboard after sign-in' });

    // Setup: recovery kit, three words, device key and vault.
    await page.goto(`${BASE}/dashboard/setup`);
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
    await page.goto(`${BASE}/dashboard/transfer`);
    await page.waitIdle();
    assert.equal((await call('/fund', {})).status, 200);

    // A checked invoice with a payment on Step 3: the sample (Manila Freight, BDO Unibank, Inc., •••• 4471).
    const read = await call('/invoices', { sample: true });
    assert.equal(read.status, 201);
    const inv = read.json.invoice;
    assert.equal((await call(`/invoices/${inv.id}/verify-bank`, { spokeTo: 'Rhea Santos', numberCalled: '+63 2 8700 1100' })).status, 200);
    const fields = { ...inv.fields, amountPhpMinor: String(inv.fields.amountPhpMinor), einvoiceRef: inv.fields.einvoiceRef ?? null };
    const paid = await call(`/invoices/${inv.id}/pay`, { fields, confirmed: inv.needsConfirmation });
    assert.equal(paid.status, 200);
    const paymentId = paid.json.payment.id;
    const ready = await call('/invoices?view=ready');
    assert.deepEqual(
      ready.json.bills.map((b) => [b.number, b.bank, b.bankCode, b.last4, b.amountPhpMinor]),
      [['INV-0412', 'BDO Unibank, Inc.', 'BDO', '4471', '56000000']],
    );

    // The same supplier as a saved recipient: its bank reads "BDO Unibank".
    const rc = await call('/recipients', { name: inv.fields.supplierName, kind: 'business', registration: 'CS201912345', bankCode: 'BDO', accountNumber: '002188304471', accountNumberAgain: '002188304471', holderName: inv.fields.supplierName, addressLine: '1 Port Area', city: 'Manila', check: { when: 'now', by: 'Demo Operator' } });
    assert.equal(rc.status, 201);
    assert.equal(rc.json.recipient.bank, 'BDO Unibank');

    // Pick it (double-click goes straight on): Step 2 offers the invoice.
    await page.goto(`${BASE}/dashboard/transfer`);
    await page.waitIdle();
    await page.waitFor(() => [...document.querySelectorAll('main button, main [role=radio]')].some((x) => /Manila Freight Services/.test(x.innerText)), [], { what: 'the saved recipient' });
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('main button, main [role=radio]')].find((x) => /Manila Freight Services/.test(x.innerText));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    });
    await page.waitFor(() => /step=amount/.test(location.search), [], { what: 'Step 2' });
    await page.find('heading', 'How much?');
    await page.waitFor(() => [...document.querySelectorAll('.iso-chip')].some((c) => /Use invoice/.test(c.innerText)), [], { what: 'the Use invoice chip' });
    const chips = await page.evaluate(() => [...document.querySelectorAll('.iso-chip')].filter((c) => /Use invoice/.test(c.innerText)).map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(chips, ['Use invoice INV-0412 · ₱560,000']);

    // The chip opens that invoice's own payment on Step 3.
    await page.evaluate(() => [...document.querySelectorAll('.iso-chip')].find((c) => /Use invoice/.test(c.innerText)).click());
    await page.waitFor(() => /step=quote/.test(location.search), [], { what: 'Step 3', timeoutMs: 60_000 });
    await page.find('heading', 'Pick a route', { timeoutMs: 60_000 });
    assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get('payment')), paymentId, 'the invoice’s own payment, not a second one');
    const facts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.iso-txhead__metrics > div')].map((d) => [d.querySelector('dt').innerText.trim(), d.querySelector('dd').innerText.trim()])));
    assert.equal(facts['They receive'], '₱560,000.00');
    assert.match(await page.evaluate(() => document.querySelector('.iso-txhead__sub')?.innerText ?? ''), /INV-0412/);
  } finally {
    await browser.close();
  }
});
