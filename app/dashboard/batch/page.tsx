import { BatchFlow } from '@/components/solana/BatchFlow';
import { SolanaDashPage } from '@/components/solana/SolanaDashPage';

export const metadata = { title: 'Batch payout · Splash' };

/**
 * Pay many suppliers at once (prompt 07 §5.5): chunked by measured transaction size, one approval for
 * every chunk, each chunk all-or-none, a failed chunk retried alone. `?batch=` opens a batch.
 */
export default async function BatchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const batchId = typeof sp.batch === 'string' && /^bat_[0-9a-f]{16}$/.test(sp.batch) ? sp.batch : null;
  return (
    <SolanaDashPage kicker="Payments" title="Batch payout" description="Pay many suppliers from one file. One approval on this device; each chunk pays all its suppliers or none." wide>
      {/* Keyed by the batch: opening another (or none) starts from a clean screen. */}
      <BatchFlow key={batchId ?? 'new'} batchId={batchId} />
    </SolanaDashPage>
  );
}
