/**
 * Waiting for a signature (prompt 07 §5.1). Poll with backoff until the target commitment, an
 * on-chain error, or the blockhash expiring, whichever comes first.
 *
 *   confirmed   what the app shows: the transaction landed and a supermajority voted on it
 *   finalized   what evidence waits for: it can no longer be rolled back
 *   expired     the status is unknown AND the chain is past the transaction's last valid block
 *               height, so it can never land. The caller rebuilds with a fresh blockhash and has the
 *               approver sign again; the old bytes are never resent.
 *   failed      it landed and the program returned an error
 *   pending     still unknown at the time limit, blockhash not yet expired: try again later
 *
 * The expiry check re-reads the status after seeing the height pass, so a transaction that landed
 * in the very last valid block is not reported as expired.
 */
import type { ChainClient, Commitment } from '../solana/simulator.ts';

export type CommitmentOutcome =
  | { status: 'confirmed' | 'finalized' }
  | { status: 'failed'; err: string }
  | { status: 'expired' }
  | { status: 'pending' };

/** Delays between polls, in ms; the last repeats. */
export const BACKOFF_MS: readonly number[] = [250, 500, 1_000, 2_000, 4_000];

export interface AwaitOptions {
  signature: string;
  lastValidBlockHeight: number | null;
  target: Exclude<Commitment, 'processed'>;
  /** Give up as `pending` after this long. 0: a single check, no waiting. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const reached = (got: Commitment | null, target: AwaitOptions['target']) =>
  got === 'finalized' || (target === 'confirmed' && got === 'confirmed');

export async function awaitCommitment(chain: Pick<ChainClient, 'getSignatureStatus' | 'getBlockHeight'>, opts: AwaitOptions): Promise<CommitmentOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const clock = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const started = clock();
  for (let attempt = 0; ; attempt++) {
    const status = await chain.getSignatureStatus(opts.signature);
    if (status.err) return { status: 'failed', err: status.err };
    if (reached(status.confirmationStatus, opts.target)) return { status: status.confirmationStatus === 'finalized' ? 'finalized' : 'confirmed' };
    if (status.confirmationStatus === null && opts.lastValidBlockHeight !== null) {
      const height = await chain.getBlockHeight();
      if (height > opts.lastValidBlockHeight) {
        const again = await chain.getSignatureStatus(opts.signature);
        if (again.err) return { status: 'failed', err: again.err };
        if (reached(again.confirmationStatus, opts.target)) return { status: again.confirmationStatus === 'finalized' ? 'finalized' : 'confirmed' };
        if (again.confirmationStatus === null) return { status: 'expired' };
      }
    }
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
    if (clock() - started + delay > timeoutMs) return { status: 'pending' };
    await sleep(delay);
  }
}
