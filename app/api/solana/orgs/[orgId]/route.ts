import { handle, schemas } from '@/lib/solana-app/http';
import { ServiceError } from '@/lib/solana-app/errors';
import { orgSummary } from '@/lib/solana-app/service';

export const dynamic = 'force-dynamic';

/** Company, vault, balance (total = sum of parts) and payments. */
export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  return handle(async () => {
    const { orgId } = await params;
    if (!schemas.orgId.safeParse(orgId).success) throw new ServiceError('org_not_found', 'Unknown company.', 404);
    return await orgSummary(orgId);
  });
}
