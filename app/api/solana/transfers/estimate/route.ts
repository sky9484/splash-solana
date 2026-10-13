import { ServiceError } from '@/lib/solana-app/errors';
import { rateStrip } from '@/lib/solana-app/nav-counts';
import { DEMO_LIMITS, getOrg } from '@/lib/solana-app/service';
import { estimateTransfer } from '@/lib/solana-app/transfer-estimate';
import { utcDay } from '@/lib/solana/kora';
import { companyRoute } from '@/lib/server/solana-company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINOR = /^\d{1,15}$/;
const BANK = /^[A-Z]{2,6}$/;

/**
 * Transfer, Step 2 (prompt 10 §5.5): the other amount at the partner's rate, the rail for this bank and
 * amount, and what's left of today's limits. Asked about 300 ms after a person stops typing.
 *
 *   ?kind=bank&bank=BDO&php=28700000      they receive ₱287,000.00
 *   ?kind=bank&bank=BDO&usd=5000000000    you send US$5,000.00 before fees
 *   ?kind=peer&usd=5000000000             a payment to a business on Splash
 *
 * Display only: it quotes nothing, saves nothing and reserves nothing.
 */
export async function GET(request: Request) {
  return companyRoute(request, async (ctx) => {
    const q = new URL(request.url).searchParams;
    const kind = q.get('kind');
    const php = q.get('php');
    const usd = q.get('usd');
    const bank = q.get('bank');
    if (kind !== 'bank' && kind !== 'peer') throw new ServiceError('bad_request', 'Say who is paid: a bank or a business on Splash.');
    if ((php === null) === (usd === null) || (php !== null && !MINOR.test(php)) || (usd !== null && !MINOR.test(usd))) throw new ServiceError('bad_request', 'Give one amount, in whole units.');
    if (kind === 'peer' && usd === null) throw new ServiceError('bad_request', 'A payment to a business on Splash is in US$.');
    if (bank !== null && !BANK.test(bank)) throw new ServiceError('bad_request', 'Choose the recipient’s bank.');
    const org = getOrg(ctx.orgId);
    const limits = { perPaymentMinor: DEMO_LIMITS.perPaymentUsdcMinor, dailyMinor: DEMO_LIMITS.dailyUsdcMinor, usedTodayMinor: org.dailyDebits[utcDay(new Date())] ?? 0n };
    const estimate =
      kind === 'peer'
        ? estimateTransfer({ kind, usdMinor: BigInt(usd!), limits })
        : php !== null
          ? estimateTransfer({ kind, bankCode: bank, phpMinor: BigInt(php), rate: rateStrip().rate, limits })
          : estimateTransfer({ kind, bankCode: bank, usdMinor: BigInt(usd!), rate: rateStrip().rate, limits });
    return { estimate, rateLabel: rateStrip().label };
  });
}
