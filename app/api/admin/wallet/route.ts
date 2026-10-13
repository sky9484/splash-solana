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
 * The SAS attester signs evidence roots only. Each comes with its balance:
 * lamports for the Solana keys, MIST for the evidence sponsor (null when the
 * network was not read). Amounts are decimal strings of integers.
 */
export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Staff authentication required' }, { status: 401 });
  }

  try {
    const rt = runtime();
    const feePayer = (await rt.chain.getFeePayer()).toBase58();
    const attester = rt.attester.publicKey.toBase58();
    const cluster = rt.env.cluster;
    const lamportsOf = async (address: string) => {
      try {
        return (await rt.chain.getSolBalance(address)).toString();
      } catch {
        return null;
      }
    };
    const { evidenceSponsorFromEnv, sponsorBalanceMist } = await import('@/lib/evidence-sui/sponsor');
    const sponsor = evidenceSponsorFromEnv();
    const sponsorAddress = sponsor ? await sponsor.address() : null;
    const sponsorMist = sponsorAddress ? await sponsorBalanceMist(sponsorAddress) : null;
    return NextResponse.json({
      mode: rt.env.mode,
      cluster,
      feePayer: { role: 'Kora fee payer', address: feePayer, lamports: await lamportsOf(feePayer), explorerUrl: explorerAddressUrl(feePayer, cluster) },
      attester: { role: 'SAS attester (evidence roots only)', address: attester, lamports: await lamportsOf(attester) },
      evidenceSponsor: sponsorAddress ? { role: 'Sui sponsor (evidence only)', address: sponsorAddress, mist: sponsorMist === null ? null : sponsorMist.toString() } : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read the Splash-held keys' },
      { status: 500 },
    );
  }
}
