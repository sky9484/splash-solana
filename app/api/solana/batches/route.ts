import { parseSupplierRows, SAMPLE_BATCH_CSV } from '@/lib/solana-app/batch-rows';
import { batchView, createBatch, listBatches } from '@/lib/solana-app/batch-service';
import { ServiceError } from '@/lib/solana-app/errors';
import { readBody, schemas } from '@/lib/solana-app/http';
import { companyRoute, requireMoneyGates } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** This company's batch payouts, newest first. */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => ({ batches: listBatches(ctx.orgId) }));
}

/**
 * A batch from a supplier file (CSV text) or the sample: each row gets its own partner deposit and
 * quote, the rules run on the total, and the chunks are previewed. Nothing is signed or sent yet.
 */
export async function POST(request: Request) {
  return companyRoute(
    request,
    async (ctx) => {
      const body = await readBody(request, schemas.batchCreate);
      await requireMoneyGates(ctx);
      const { rows, errors } = parseSupplierRows(body.sample ? SAMPLE_BATCH_CSV : body.csv!);
      if (errors.length) throw new ServiceError('bad_request', `Some rows need fixing before this batch can be quoted: ${errors.map((e) => e.message).join(' ')}`, 400, { errors });
      const b = await createBatch(ctx.orgId, { rows, by: ctx.personName });
      return { batch: batchView(b) };
    },
    201,
  );
}
