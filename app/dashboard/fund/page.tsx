// iso-ui
import { Balance } from '@/components/solana/Balance';

export const metadata = { title: 'Balance · Splash' };

/** Balance (prompt 10 §5.10): the Payments account, what's free and waiting, how to add money, and money in and out. */
export default function BalancePage() {
  return <Balance />;
}
