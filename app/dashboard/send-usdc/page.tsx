import { redirect } from 'next/navigation';

/**
 * Sending USDC is part of Transfer on the Solana build (prompt 07 §6.2). The
 * query (a Zeke hand-off's recipient and amount) is carried across.
 */
export default async function SendUsdcPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') query.set(key, value);
  }
  const suffix = query.toString();
  redirect(suffix ? `/dashboard/transfer?${suffix}` : '/dashboard/transfer');
}
