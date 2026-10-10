import { ServiceError } from '@/lib/solana-app/errors';
import { toWire } from '@/lib/solana-app/json';
import { handle } from '@/lib/solana-app/http';
import { evidencePack } from '@/lib/solana-app/service';

export const dynamic = 'force-dynamic';

/** Download the evidence pack (JSON) for an auditor. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const pack = evidencePack(id);
    return new Response(JSON.stringify(toWire(pack), null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="splash-evidence-${id}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) return handle(() => { throw e; });
    throw e;
  }
}
