import { SolanaDashPage } from '@/components/solana/SolanaDashPage';
import { TreasuryDesk } from '@/components/solana/TreasuryDesk';

export const metadata = { title: 'Treasury · Splash' };

const MINOR = /^\d{1,15}$/;
const BACK = /^\/dashboard\/(invoices|transfer|batch)(\?quote=inv_[0-9a-f]{16})?$/;

/**
 * Treasury (Sky, 13 Oct): the company's operating cash, in vault #1 of its own Squads multisig, and
 * the moves that fund the payments vault (vault #0) directly. Both vaults are the company's: Splash
 * holds no key to either, and a person approves every move on a device. `?move=` prefills a move to
 * the payments vault (a shortfall, in USDC minor units); `?back=` is where to return after it.
 */
export default async function TreasuryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const move = typeof sp.move === 'string' && MINOR.test(sp.move) ? sp.move : null;
  const back = typeof sp.back === 'string' && BACK.test(sp.back) ? sp.back : null;
  return (
    <SolanaDashPage kicker="Money" title="Treasury" description="Your operating cash, in a second vault of your own multisig. Move it to your payments vault when you need to pay.">
      <TreasuryDesk prefillMinor={move} back={back} />
    </SolanaDashPage>
  );
}
