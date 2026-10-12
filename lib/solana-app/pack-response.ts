/**
 * The evidence pack as a download: one JSON file an auditor can check without Splash. Shared by the
 * company's own route and the auditor's share link.
 */
import { toWire } from './json.ts';
import { evidencePack } from './service.ts';

export async function evidencePackResponse(receiptId: string): Promise<Response> {
  const pack = await evidencePack(receiptId);
  return new Response(JSON.stringify(toWire(pack), null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="splash-evidence-${receiptId}.json"`,
      'cache-control': 'no-store',
    },
  });
}
