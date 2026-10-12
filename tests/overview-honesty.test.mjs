import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * The overview is read as a reading.
 *
 * It is the first screen after sign-in and it looks like an instrument panel, so every figure on it is
 * believed. An earlier overview showed a volume, a pipeline, a settlement window and a KYB verdict
 * that were not read from anything (see this file's history). The Solana overview (prompt 07 §6.2)
 * shows three things, each read from the signed-in company: the vault's USDC balance from its token
 * account, what is waiting for approval, and the last five payments in the state machine's words.
 */

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
/** Comments describe what was removed, so assertions run against code only. */
const codeOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
const overview = async () => codeOnly((await read('app/dashboard/page.tsx')) + (await read('components/solana/Overview.tsx')));

test('no invented figures in the rendered code: every amount is formatted from a read', async () => {
  const code = await overview();
  // A currency figure typed into the page, rather than formatted from data, is invented.
  assert.doesNotMatch(code, /US\$\s?\d|₱\s?\d|\$\d[\d,]*\.\d{2}/, 'no literal money on the page');
  assert.doesNotMatch(code, /\+\d+(\.\d+)?%/, 'no invented growth');
  assert.match(code, /php\(p\.amountPhpMinor\)/);
  assert.match(code, /usd\(p\.youPayUsdcMinor\)/);
  assert.match(code, /<BalanceHeader balance=\{c\.balance\}/, 'the balance is the vault token account, as the server read it');
});

test('compliance is not asserted here: the overview states no KYB verdict at all', async () => {
  const code = await overview();
  // "Approved" as a verdict word in copy; the approvals counter (`p.approvals.approved`) is data, not copy.
  assert.doesNotMatch(code, /KYB|Sumsub|risk tier|verified business|\bApproved\b/);
});

test('the numbers come from one read, so the panels cannot disagree', async () => {
  const code = await overview();
  assert.equal((code.match(/useCompany\(\)/g) ?? []).length, 1, 'one company read feeds every panel');
  assert.doesNotMatch(code, /fetch\(/, 'no second source');
  assert.match(code, /c\.payments\.filter\(\(p\) => p\.awaitingApproval\)/);
  assert.match(code, /c\.payments\.slice\(0, 5\)/);
});

test('an empty vault and an empty list say so, and say what to do', async () => {
  const code = await overview();
  assert.match(code, /Nothing is waiting\./);
  assert.match(code, /No payments yet\./);
  // Empty: fund the payments vault (from the treasury, or by adding USDC), or pay the first invoice.
  assert.match(code, /Fund your payments vault/);
  assert.match(code, /Pay your first supplier invoice/);
});

test('what is simulated is labelled simulated: the balance carries its own label', async () => {
  const header = codeOnly(await read('components/solana/BalanceHeader.tsx'));
  assert.match(header, /Simulated test USDC/);
  assert.match(header, /Devnet test USDC/);
  // The total is exactly the sum of its parts, or the difference is named.
  assert.match(header, /sum !== total/);
});
