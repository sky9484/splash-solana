import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBatchFile } from '../lib/batch-parse.ts';
import { makeXlsx } from './fixtures/make-xlsx.mjs';

/* parseBatchFile takes a browser File and runs in the browser. Node 24 has
   File, and the xlsx reader is pure JS with no DOMParser and no Node
   built-ins, so this exercises the same code the dashboard ships — not a
   Node-only twin of it. */

const file = (name, rows) => new File([makeXlsx(rows)], name);

test('an .xlsx batch parses through the same path the browser uses', async () => {
  const batch = await parseBatchFile(
    file('suppliers.xlsx', [
      ['Recipient', 'Account', 'Currency', 'Reference', 'Amount', 'Due'],
      ['Acme Manila', 'PH-0001', 'PHP', 'INV-1001', 1250.5, new Date(Date.UTC(2026, 8, 30))],
      ['Bayan Cebu', 'PH-0002', 'PHP', 'INV-1002', 800, new Date(Date.UTC(2026, 9, 1))],
    ]),
  );

  assert.equal(batch.fileName, 'suppliers.xlsx');
  assert.equal(batch.rows.length, 2);
  assert.deepEqual(batch.rows[0], {
    name: 'Acme Manila',
    address: 'PH-0001',
    country: 'PH',
    purpose: 'INV-1001',
    amount: '1250.5',
  });
  assert.equal(batch.rows[1].amount, '800');
  assert.equal(batch.corridor, 'PH');
});

test('a date cell arrives as YYYY-MM-DD, not a serial and not a Date string', async () => {
  // "Reference" is the purpose alias, so route the date there to observe it.
  const batch = await parseBatchFile(
    file('dated.xlsx', [
      ['Recipient', 'Account', 'Currency', 'Reference', 'Amount'],
      ['Acme Manila', 'PH-0001', 'PHP', new Date(Date.UTC(2026, 8, 30)), 10],
    ]),
  );
  assert.equal(batch.rows[0].purpose, '2026-09-30');
});

test('an entirely empty row is dropped; an empty cell becomes ""', async () => {
  const batch = await parseBatchFile(
    file('gaps.xlsx', [
      ['Recipient', 'Account', 'Currency', 'Reference', 'Amount'],
      ['Acme Manila', 'PH-0001', 'PHP', null, 10],
      [null, null, null, null, null],
      ['Bayan Cebu', 'PH-0002', 'PHP', 'INV-2', 20],
    ]),
  );
  assert.equal(batch.rows.length, 2);
  assert.equal(batch.rows[0].purpose, '');
  assert.equal(batch.rows[1].name, 'Bayan Cebu');
});

test('legacy .xls is refused by name, since the one reader that handled it is gone', async () => {
  await assert.rejects(
    () => parseBatchFile(new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'old.xls')),
    /Upload a \.csv or \.xlsx batch file\./,
  );
});
