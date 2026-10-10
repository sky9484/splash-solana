import { handle, readBody, schemas } from '@/lib/solana-app/http';
import { createOrg } from '@/lib/solana-app/service';

/** Step 1: a demo company. Returns its id; the browser keeps it. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request, schemas.createOrg);
    const org = createOrg(body);
    return { orgId: org.id, companyName: org.companyName };
  }, 201);
}
