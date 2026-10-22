import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { DirectoryError, directorySetting, setDirectorySetting } from '@/lib/server/splash-directory';
import { companyRoute, requireCanAct } from '@/lib/server/solana-company';
import { setupDb } from '@/lib/server/setup-member';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const asService = (e: unknown) => (e instanceof DirectoryError ? new ServiceError('bad_request', e.message, e.status) : e);

/** "Let other Splash businesses find us": off by default, under a handle. */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => {
    if (!process.env.DATABASE_URL) throw new ServiceError('bad_request', 'The Splash directory needs the database; it is off in this demo.', 409);
    return { directory: await directorySetting(await setupDb(), ctx.orgId).catch((e) => Promise.reject(asService(e))) };
  });
}

/** Only an owner decides whether the company can be found. */
export async function PUT(request: Request) {
  return companyRoute(request, async (ctx) => {
    requireCanAct(ctx);
    if (!ctx.isOwner) throw new ServiceError('not_authorized', 'Only an owner can change whether the company can be found.', 403);
    const body = await readBody(request, schemas.directorySetting);
    if (!process.env.DATABASE_URL) throw new ServiceError('bad_request', 'The Splash directory needs the database; it is off in this demo.', 409);
    return { directory: await setDirectorySetting(await setupDb(), ctx.orgId, body).catch((e) => Promise.reject(asService(e))) };
  });
}
