import { readBody, schemas } from '@/lib/solana-app/http';
import { listTemplates, saveTemplate } from '@/lib/solana-app/templates';
import { companyRoute, requireCanAct } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The company's transfer templates, newest first: who and how much, never a bank number. */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => ({ templates: listTemplates(ctx.orgId) }));
}

/** "Save as template" on a transfer's receipt. Starting from one quotes, checks and asks for approval again. */
export async function POST(request: Request) {
  return companyRoute(
    request,
    async (ctx) => {
      requireCanAct(ctx);
      const body = await readBody(request, schemas.templateSave);
      return { template: await saveTemplate(ctx.orgId, body.paymentId, ctx.personName) };
    },
    201,
  );
}
