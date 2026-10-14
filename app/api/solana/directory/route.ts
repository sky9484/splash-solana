import { ServiceError } from '@/lib/solana-app/errors';
import { searchDirectory } from '@/lib/server/splash-directory';
import { companyRoute } from '@/lib/server/solana-company';
import { setupDb } from '@/lib/server/setup-member';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Find a business on Splash" (prompt 10 §5.4): by name, handle or registration number. Only verified
 * companies that chose to be found, and have an account, show; never your own.
 */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 80);
    if (!process.env.DATABASE_URL) throw new ServiceError('bad_request', 'Finding businesses on Splash needs the database; it is off in this demo.', 409);
    return { results: await searchDirectory(await setupDb(), ctx.orgId, q) };
  });
}
