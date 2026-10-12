import { NextResponse } from 'next/server';

import { explorerAddressUrl } from '@/lib/solana/config';
import { runtime } from '@/lib/solana-app/runtime';
import { getAdminSession } from '@/lib/server/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * The keys Splash itself holds, public side only (prompt 07 §7). None of them
 * can move customer money: the Kora fee payer pays network fees under an
 * allowlist and never sends SOL or tokens (I-3); the evidence sponsor pays
 * Sui gas for allowlist updates only. No private key ever leaves the server.
 * The SAS attester signs evidence roots only. Balances join with the admin
 * console rebuild (Phase 5).
 */
export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Staff authentication required' }, { status: 401 });
  }

  try {
    const rt = runtime();
    const feePayer = (await rt.chain.getFeePayer()).toBase58();
    const cluster = rt.env.cluster;
    const { evidenceSponsorFromEnv } = await import('@/lib/evidence-sui/sponsor');
    const sponsor = evidenceSponsorFromEnv();
    return NextResponse.json({
      mode: rt.env.mode,
      cluster,
      feePayer: { role: 'Kora fee payer', address: feePayer, explorerUrl: explorerAddressUrl(feePayer, cluster) },
      attester: { role: 'SAS attester (evidence roots only)', address: rt.attester.publicKey.toBase58() },
      evidenceSponsor: sponsor ? { role: 'Sui sponsor (evidence only)', address: await sponsor.address() } : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read the Splash-held keys' },
      { status: 500 },
    );
  }
}
