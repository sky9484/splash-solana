/**
 * The legacy funding API, retired (prompt 10 Phase 3; docs/solana-build/FUNDING-AUDIT.md CRIT-1).
 *
 * `/api/funding/{sessions,sessions/[id],deposits,usd-deposits,options}` came from the earlier build.
 * Its CCTP path handed out a deposit address that was not the company's own account (and drew it as a
 * QR code). Nothing on the dashboard calls it any more: money is added from Balance or Transfer's
 * "Add money another way", and it lands only in the company's own Payments account. Every method
 * answers 410 Gone, before reading anything, so no address can be handed out again.
 */
export const RETIRED_FUNDING_MESSAGE =
  'This funding API is retired. Add money from Balance on the dashboard: it lands only in your own Payments account.';

export function retiredFundingRoute(): Response {
  return new Response(JSON.stringify({ code: 'gone', error: { code: 'gone', message: RETIRED_FUNDING_MESSAGE } }), {
    status: 410,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
