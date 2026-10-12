// Prompt 07 §6.2: the /solana demo moved into the signed-in dashboard, and the dashboard's duplicates
// merged. Old addresses answer 308 from proxy.ts with their query, so bookmarks and shared links land.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { movedRoute } from '../lib/route-moves.ts';

test('every old address has its new home', () => {
  const map = {
    '/solana': '/dashboard',
    '/solana/onboarding': '/dashboard/setup',
    '/solana/fund': '/dashboard/fund',
    '/solana/pay': '/dashboard/transfer',
    '/solana/policy': '/dashboard/settings/policy',
    '/solana/zeke': '/dashboard/zeke',
    '/solana/receipts/rcpt_0123456789abcdef': '/dashboard/receipts/rcpt_0123456789abcdef',
    '/dashboard/overview': '/dashboard',
    '/dashboard/send-usdc': '/dashboard/transfer',
    '/dashboard/transfers': '/dashboard/history',
    '/dashboard/copilot': '/dashboard/zeke',
    '/dashboard/0xwal': '/dashboard/zeke',
  };
  for (const [from, to] of Object.entries(map)) assert.equal(movedRoute(from), to, from);
  assert.equal(movedRoute('/solana/pay/'), '/dashboard/transfer', 'a trailing slash is the same page');
  assert.equal(movedRoute('/solana/anything-else'), '/dashboard', 'the rest of the demo lands on the dashboard');
});

test('pages that did not move are left alone, and a malformed receipt id is not rewritten into one', () => {
  for (const path of ['/', '/dashboard', '/dashboard/transfer', '/dashboard/history', '/receipt/shr_x', '/api/solana/company', '/solanafoo']) {
    assert.equal(movedRoute(path), null, path);
  }
  assert.equal(movedRoute('/solana/receipts/../../admin'), '/dashboard');
});

test('proxy.ts answers 308 before anything else runs, and keeps the query', async () => {
  const proxy = await readFile(new URL('../proxy.ts', import.meta.url), 'utf8');
  const moved = proxy.indexOf('const moved = movedRoute(pathname)');
  assert.ok(moved > 0);
  assert.ok(moved < proxy.indexOf('proxySetupRedirect('), 'the move answers before the setup check');
  assert.match(proxy, /target\.pathname = moved;\s*return NextResponse\.redirect\(target, 308\);/);
  // The old pages are gone, so nothing renders at an old address by accident.
  for (const gone of ['app/solana/page.tsx', 'app/dashboard/overview/page.tsx', 'app/dashboard/send-usdc/page.tsx', 'app/dashboard/transfers/page.tsx', 'app/dashboard/copilot/page.tsx', 'app/dashboard/0xwal/page.tsx']) {
    await assert.rejects(readFile(new URL(`../${gone}`, import.meta.url)), /ENOENT/, gone);
  }
});
