import { faucetUrl, suiVisionAccountUrl } from '@/lib/explorer';
import { NextResponse } from 'next/server';

import { getAdminSession } from '@/lib/server/admin-auth';
import { getOperatorWalletInfo } from '@/lib/server/sui-settlement';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAdminSession();

  if (!session) {
    return NextResponse.json({ error: 'Staff authentication required' }, { status: 401 });
  }

  try {
    const wallet = await getOperatorWalletInfo();
    const network = process.env.SUI_NETWORK ?? 'testnet';
    const faucet = faucetUrl(wallet.address);

    return NextResponse.json({
      address: wallet.address,
      totalSui: wallet.totalSui,
      totalMist: wallet.totalMist,
      coinCount: wallet.coinCount,
      network,
      faucetUrl: faucet,
      suiVisionUrl: suiVisionAccountUrl(wallet.address),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read operator wallet' },
      { status: 500 },
    );
  }
}
