// iso-ui
import { Treasury } from '@/components/solana/treasury/Treasury';

export const metadata = { title: 'Treasury · Splash' };

const MINOR = /^\d{1,15}$/;
const BACK = /^\/dashboard\/(invoices|invoices\/pay|transfer|batch)(\?(quote|payment|invoice)=(inv|pay)_[0-9a-f]{16})?$/;
const SWEEP = /^swp_[0-9a-f]{16}$/;

/**
 * Treasury (prompt 10 §7): the Payments account, the Reserve and Investments, all accounts of the
 * company's own; Splash holds no key to any of them, and a person approves every move and order on a
 * device. `?move=` prefills a move from the Reserve to the Payments account (a shortfall, in US$ minor
 * units) and `?back=` is where to return after it; `?sweep=` opens today's sweep draft for review.
 */
export default async function TreasuryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const move = typeof sp.move === 'string' && MINOR.test(sp.move) ? sp.move : null;
  const back = typeof sp.back === 'string' && BACK.test(sp.back) ? sp.back : null;
  const sweep = typeof sp.sweep === 'string' && SWEEP.test(sp.sweep) ? sp.sweep : null;
  return <Treasury prefillMoveMinor={move} back={back} sweepId={sweep} />;
}
