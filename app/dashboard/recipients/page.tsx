'use client';

import { useLaunchScope } from '@/components/dashboard/CustodyPhaseContext';
import { Recipients } from '@/components/solana/Recipients';
import { WalletRecipients } from '@/components/solana/WalletRecipients';

/**
 * Recipients (prompt 12 §6.1): the bank recipients Transfer pays, from the company's own records. A
 * USDC-only launch pays no bank recipient (lib/launch-scope-rules.ts), so there the page is the wallet
 * lane alone.
 */
export default function RecipientsPage() {
  return useLaunchScope() === 'stablecoin' ? <WalletRecipients /> : <Recipients />;
}
