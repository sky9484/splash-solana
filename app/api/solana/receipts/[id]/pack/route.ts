import { saveCompany } from '@/lib/solana-app/company';
import { ServiceError } from '@/lib/solana-app/errors';
import { handle, schemas } from '@/lib/solana-app/http';
import { evidencePackResponse } from '@/lib/solana-app/pack-response';
import { assertReceiptOf } from '@/lib/solana-app/service';
import { companyForRequest } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Download the evidence pack (JSON) for this company's auditor. It holds the invoice fields and salt, so it is the company's to hand out. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const bound = await companyForRequest(request);
    if (bound.response) return bound.response;
    try {
      if (!schemas.receiptId.safeParse(id).success) throw new ServiceError('receipt_not_found', 'That receipt is not on the server for this company.', 404);
      assertReceiptOf(id, bound.ctx.orgId);
      return await evidencePackResponse(id);
    } finally {
      await saveCompany(bound.ctx.orgId);
    }
  } catch (e) {
    return handle(() => {
      throw e;
    });
  }
}
