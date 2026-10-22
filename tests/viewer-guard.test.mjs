// A viewer reads; it never changes what gets paid (review finding, 16 Oct). The role comes from the
// membership row on each request (lib/server/setup-member.ts → CompanyContext.role), never from the
// session's display copy, and every company route that changes something calls requireCanAct first.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = 'app/api/solana';
/** Changing routes with their own, narrower check (owner, finance admin, or a signed device step). */
const OWN_CHECK = new Set([
  'app/api/solana/partner/webhook/route.ts', // the payout partner, signed with its HMAC; no session
  'app/api/solana/invoices/[id]/reveal/route.ts', // owner or finance admin, after a device step-up
  'app/api/solana/recipients/[id]/reveal/route.ts', // the same
  'app/api/solana/invoices/[id]/verify-bank/route.ts', // recordCallBack refuses a viewer
  'app/api/solana/recipients/route.ts', // createRecipient refuses a viewer's call-back
  'app/api/solana/recipients/[id]/verify/route.ts', // verifyRecipient refuses a viewer
  'app/api/solana/receipts/[id]/share/route.ts', // makes a read-only link to a receipt
  'app/api/solana/treasury/eligibility/route.ts', // owner only
  'app/api/solana/treasury/sweep/route.ts', // owner only
  'app/api/solana/treasury/orders/quote/route.ts', // a price, changes nothing
]);

function routes(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? routes(p) : n === 'route.ts' ? [p.split(path.sep).join('/')] : [];
  });
}

test('every company route that changes something refuses a viewer first', () => {
  const missing = [];
  for (const file of routes(ROOT)) {
    const src = readFileSync(file, 'utf8');
    if (!/export async function (POST|PUT|DELETE|PATCH)\b/.test(src) || !src.includes('companyRoute(') || OWN_CHECK.has(file)) continue;
    for (const m of src.matchAll(/export async function (POST|PUT|DELETE|PATCH)\b[\s\S]*?async \(ctx\) => \{\s*([^\n]*)/g)) {
      if (!m[2].startsWith('requireCanAct(ctx);')) missing.push(`${file} ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the checks read the role from the membership row, not the session', () => {
  for (const file of routes(ROOT)) assert.doesNotMatch(readFileSync(file, 'utf8'), /session\.userRole/, file);
  const member = readFileSync('lib/server/setup-member.ts', 'utf8');
  assert.match(member, /role: WORKSPACE_ROLE\[ctx\.role\] \?\? 'viewer'/, 'an unknown role is treated as a viewer');
  const company = readFileSync('lib/server/solana-company.ts', 'utf8');
  assert.match(company, /role: auth\.role,/);
  assert.match(company, /if \(ctx\.role === 'viewer'\) throw new ServiceError\('not_authorized'/);
});
