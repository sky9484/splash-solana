import { shortKey } from './client';

type Link = { solscanUrl: string | null; explorerUrl: string | null };
type Tx = Link & { purpose: string; network: string; signature: string; simulated: boolean };
type Account = Link & { label: string; address: string };

const PURPOSE: Record<string, string> = {
  squads_proposal_create: 'Proposal created',
  squads_proposal_approve: 'Approved',
  squads_vault_execute: 'Sent from your vault',
  spl_transfer: 'USDC transfer',
  cctp_burn: 'CCTP burn on Solana',
  cctp_mint: 'CCTP mint on Polygon',
};

/** One row per transaction: a transaction that proposes and approves, or executes and transfers, is one thing to open. */
function labelFor(purposes: string[]): string {
  if (purposes.includes('squads_vault_execute')) return 'Sent from your vault';
  if (purposes.includes('squads_proposal_create') && purposes.includes('squads_proposal_approve')) return 'Proposed and approved';
  return PURPOSE[purposes[0]!] ?? purposes[0]!;
}

function bySignature(transactions: Tx[]): Array<Tx & { purposes: string[] }> {
  const out = new Map<string, Tx & { purposes: string[] }>();
  for (const t of transactions) {
    const hit = out.get(t.signature);
    if (hit) hit.purposes.push(t.purpose);
    else out.set(t.signature, { ...t, purposes: [t.purpose] });
  }
  return [...out.values()];
}

/**
 * How to follow one payment on Solscan without Splash: the memo every one of its transactions
 * carries, each transaction, and the accounts it touched. Offline the signatures are simulated and
 * exist on no network, so there is nothing to open, and the panel says so instead of linking.
 */
export function SolscanTrace({ memo, transactions, accounts, anchor }: { memo: string; transactions: Tx[]; accounts: Account[]; anchor?: (Link & { signature: string; simulated: boolean }) | null }) {
  const simulated = transactions.every((t) => t.simulated) && (anchor?.simulated ?? true);
  const rows = [...bySignature(transactions).map((t) => ({ key: t.signature, label: labelFor(t.purposes), value: t.signature, link: t, simulated: t.simulated, onSolana: t.network === 'solana' })), ...(anchor ? [{ key: `anchor-${anchor.signature}`, label: 'Proof anchored', value: anchor.signature, link: anchor, simulated: anchor.simulated, onSolana: true }] : [])];
  return (
    <section className="sx-card sx-stack" aria-labelledby="trace-title">
      <h2 id="trace-title">Trace it on Solscan</h2>
      {simulated ? (
        <p className="sx-muted">
          These ran in the offline simulator, so they are on no network and Solscan has nothing to show. On devnet each line opens on Solscan, and each payment transaction shows the memo{' '}
          <span className="sx-mono">{memo}</span> in its program logs. The proof anchor carries the root shown under Verify.
        </p>
      ) : (
        <p className="sx-muted">
          Each payment transaction shows the memo <span className="sx-mono">{memo}</span> in its program logs on Solscan. The proof anchor carries the root shown under Verify.
        </p>
      )}
      <dl className="sx-kv">
        {rows.map((r) => (
          <div key={r.key} style={{ display: 'contents' }}>
            <dt>{r.label}</dt>
            <dd>
              <span className="sx-mono" title={r.value}>
                {shortKey(r.value, 8)}
              </span>{' '}
              {r.link.solscanUrl ? (
                <a href={r.link.solscanUrl} target="_blank" rel="noreferrer">
                  View on Solscan<span className="sx-visually-hidden"> (opens in a new tab)</span>
                </a>
              ) : (
                <span className="sx-muted">{r.simulated ? '(simulated)' : r.onSolana ? '' : '(on Polygon)'}</span>
              )}
            </dd>
          </div>
        ))}
        {accounts.map((a) => (
          <div key={a.address} style={{ display: 'contents' }}>
            <dt>{a.label}</dt>
            <dd>
              <span className="sx-mono" title={a.address}>
                {shortKey(a.address, 6)}
              </span>{' '}
              {a.solscanUrl ? (
                <a href={a.solscanUrl} target="_blank" rel="noreferrer">
                  View on Solscan<span className="sx-visually-hidden"> (opens in a new tab)</span>
                </a>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
