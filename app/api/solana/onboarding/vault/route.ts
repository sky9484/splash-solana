import { handle, readBody, schemas } from '@/lib/solana-app/http';
import { createVault } from '@/lib/solana-app/service';

/** Create the autonomous Squads vault: members are the device key and the kit; no config authority. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request, schemas.orgOnly);
    return { vault: await createVault(body.orgId) };
  }, 201);
}
