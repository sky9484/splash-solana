import { NextResponse } from 'next/server';

import { getEnv } from '@/lib/env';
import { getAdminSession } from '@/lib/server/admin-auth';
import { runHealthChecks } from '@/lib/server/health-checks';

/**
 * GET /api/health
 *
 * lib/server/seal-health.ts existed as a library with no route, so neither
 * developer could see Seal's state without writing code. This exposes it,
 * plus the database, the Sui RPC, the published package ID, Enoki, and the
 * feature flags — the same checks `npm run doctor` prints as a table, from
 * the same module, so the two cannot disagree.
 *
 * Open in development. In production it requires a staff session: the
 * report names hosts and object IDs and says which flags are on, which is
 * an operator's view, not the public's. No secret is ever in the body —
 * DATABASE_URL is reported as its host, keys as present or not.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  if (getEnv().NODE_ENV === 'production') {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Staff authentication required' }, { status: 401 });
    }
  }

  const report = await runHealthChecks();
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
