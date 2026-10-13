import { createRecipient, listRecipients } from '@/lib/server/bank-recipients';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Saved bank recipients and the partner's bank list (prompt 10 §5.3). Last 4 digits only. */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => listRecipients(ctx.orgId, { isOwner: ctx.isOwner, role: ctx.session.userRole }));
}

/**
 * A new bank recipient: the full number, typed twice, goes straight into the vault (Phase S) and is
 * never sent back. Checked now by phone, or saved to check later (it can't be paid until then).
 */
export async function POST(request: Request) {
  return companyRoute(
    request,
    async (ctx) => {
      const body = await readBody(request, schemas.recipientCreate);
      return { recipient: await createRecipient(ctx.orgId, body, { isOwner: ctx.isOwner, role: ctx.session.userRole, by: ctx.personName }) };
    },
    201,
  );
}
