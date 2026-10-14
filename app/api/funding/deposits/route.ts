import { retiredFundingRoute } from '@/lib/server/retired-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Retired (CRIT-1): see lib/server/retired-route.ts. Answers 410 before reading anything. */
export async function POST() {
  return retiredFundingRoute();
}
