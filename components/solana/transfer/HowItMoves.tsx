// iso-ui
// copy: technical
'use client';

import { Details } from '@/components/iso';

import { usd } from '../client';
import type { PaymentDTO, RouteCardDTO } from '../types';
import { phpWhole, shortName, usdWhole } from './shared';

/**
 * "How it moves" (prompt 10 §5.6): the one place on Step 3 that names how a route travels, so it may
 * say Circle's transfer and Polygon (§0.6's allowed zone). Built from the quotes: the routes, their
 * fees and their order are the engine's, never typed here, and the lane names come from the server.
 */
export function HowItMoves({ payment, payeeName }: { payment: PaymentDTO; payeeName: string }) {
  const short = shortName(payeeName);
  const names = payment.laneNames;
  if (payment.kind === 'peer') {
    const card = payment.cards[0];
    return (
      <Details summary="How it moves">
        Your dollars move from your Payments account straight into {payeeName}’s own Payments account on Splash, in one transfer: no payout partner, no
        conversion{card ? `, and ${short} gets the full ${usdWhole(card.receivePhpMinor)}` : ''}. There is no Splash fee between Splash businesses.
      </Details>
    );
  }
  const routes: RouteCardDTO[] = [...payment.cards, ...(payment.compare ? [payment.compare] : [])];
  const lane = routes.find((c) => c.lowerCostLane) ?? null;
  const direct = routes.find((c) => !c.lowerCostLane) ?? null;
  const amount = phpWhole(routes[0]?.receivePhpMinor ?? '0');
  const diff = lane && direct ? BigInt(direct.youPayUsdcMinor) - BigInt(lane.youPayUsdcMinor) : null;
  const feesDiffer = lane && direct && lane.partnerFee !== direct.partnerFee;
  const oneWinsBoth = payment.cards.length === 1;
  return (
    <Details summary="How it moves">
      <span className="iso-howto">
        <span>
          {routes.length > 1 ? `Both routes pay ${short} the full ${amount}.` : `This route pays ${short} the full ${amount}.`}{' '}
          {lane ? (
            <>
              {lane.policies.includes('cheapest') ? `The ${names.cheapest.toLowerCase()} one` : 'One route'} first moves your dollars to the partner’s lower-cost lane (Circle’s own transfer, to Polygon)
              {feesDiffer ? `, where the partner charges ${lane.partnerFee} instead of ${direct!.partnerFee}` : ''}. It’s one more step
              {diff !== null && diff > 0n ? `, and it costs ${usd(diff)} less.` : diff !== null && diff < 0n ? `, and today it costs ${usd(-diff)} more.` : '.'}
            </>
          ) : (
            'It goes straight to the partner on the same network your Payments account is on.'
          )}
        </span>
        <span>
          {oneWinsBoth
            ? `Today one route is both ${names.cheapest.toLowerCase()} and the one our engine expects to finish first. `
            : `${names.fastest} is the route our engine expects to finish first, going by the partner’s and the network’s own estimates. `}
          It’s an estimate, not a promise.
        </span>
      </span>
    </Details>
  );
}
