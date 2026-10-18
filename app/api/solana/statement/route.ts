import { statementFor, type StatementAccount } from '@/lib/solana-app/statement';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The monthly statement (prompt 12 §5.5): ?month=YYYY-MM&account=payments|treasury|all, from the
 * company's own records. Reads only; the month must be one the company has been on Splash.
 */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => {
    const q = new URL(request.url).searchParams;
    const month = q.get('month') ?? '';
    const account = (q.get('account') ?? 'payments') as StatementAccount;
    return { statement: await statementFor(ctx.orgId, month, account) };
  });
}
