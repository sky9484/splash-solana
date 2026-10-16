// copy: technical
// iso-ui
// A receipt's "Technical details" (prompt 10 §0.6: one of the places crypto words are allowed): the
// transactions behind a payment, the accounts they touched and the programs they called, each with its
// full ID to copy and, where it is on a network, a link to Solscan.
'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';

import { copyText, shortKey } from './client';

type Link = { solscanUrl: string | null; explorerUrl: string | null };
type Tx = Link & { purpose: string; network: string; signature: string; simulated: boolean };
type Account = Link & { label: string; address: string };
type Program = Link & { label: string; address: string };

const PURPOSE: Record<string, string> = {
  squads_proposal_create: 'Proposal created',
  squads_proposal_approve: 'Approved',
  squads_vault_execute: 'Sent from your vault',
  spl_transfer: 'USDC transfer',
  cctp_burn: 'CCTP burn on Solana',
  cctp_mint: 'CCTP mint on Polygon',
};

/** One row per transaction: a transaction that proposes and approves, or executes and transfers, is one thing to open. */
function labelFor(purposes: string[], auditor: boolean): string {
  if (purposes.includes('squads_vault_execute')) return auditor ? 'Sent from the company’s vault' : 'Sent from your vault';
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

/** Copies a full ID; says "Copied" for a moment. */
export function CopyId({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="iso-idrow__copy"
      onClick={async () => {
        setDone((await copyText(value)) ? 'copied' : 'failed');
        window.setTimeout(() => setDone('idle'), 1800);
      }}
    >
      {done === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {done === 'copied' ? 'Copied' : done === 'failed' ? 'Copy failed' : 'Copy'}
      <span className="iso-sr"> {label}</span>
    </button>
  );
}

function IdRow({ label, value, n, link, note }: { label: string; value: string; n: number; link: Link; note?: string | null }) {
  return (
    <div className="iso-idrow">
      <dt>{label}</dt>
      <dd>
        <span className="iso-idrow__value iso-mono" title={value}>
          {shortKey(value, n)}
        </span>
        <CopyId value={value} label={label} />
        {link.solscanUrl ? (
          <a className="iso-idrow__open" href={link.solscanUrl} target="_blank" rel="noreferrer">
            View on Solscan
            <ExternalLink size={13} aria-hidden="true" />
            <span className="iso-sr"> (opens in a new tab)</span>
          </a>
        ) : note ? (
          <span className="iso-idrow__note">{note}</span>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * How to follow one payment on Solscan without Splash: the memo every one of its transactions carries,
 * each transaction, the accounts it touched and the programs it called. Offline the signatures are
 * simulated and exist on no network, so they link nowhere and the panel says so; the programs are real
 * and always open on Solscan.
 */
export function SolscanTrace({ memo, transactions, accounts, programs = [], anchor, auditor = false }: { memo: string; transactions: Tx[]; accounts: Account[]; programs?: Program[]; anchor?: (Link & { signature: string; simulated: boolean }) | null; auditor?: boolean }) {
  // Someone outside the company reads "the company's vault", never "your vault".
  const accountLabel = (label: string) => (auditor ? label.replace(/^Your vault/, 'The company’s vault') : label);
  const simulated = transactions.every((t) => t.simulated) && (anchor?.simulated ?? true);
  const rows = [
    ...bySignature(transactions).map((t) => ({ key: t.signature, label: labelFor(t.purposes, auditor), value: t.signature, link: t as Link, note: t.simulated ? 'Simulated' : t.network === 'solana' ? null : 'On Polygon' })),
    ...(anchor ? [{ key: `anchor-${anchor.signature}`, label: 'Proof recorded', value: anchor.signature, link: anchor as Link, note: anchor.simulated ? 'Simulated' : null }] : []),
  ];
  return (
    <section className="iso-surface iso-surface--pad iso-stack iso-receipt__tech" aria-labelledby="trace-title">
      <div>
        <p className="iso-receipt__kicker">Technical details</p>
        <h2 id="trace-title" className="iso-h2">
          Trace it on Solscan
        </h2>
      </div>
      {simulated ? (
        <p className="iso-small">
          These ran in the offline simulator, so they are on no network and Solscan has nothing to show for them. On devnet each line opens on Solscan, and each payment transaction shows the memo below in its program logs. The programs are real: they open on Solscan now.
        </p>
      ) : (
        <p className="iso-small">Each payment transaction shows the memo below in its program logs on Solscan. The proof record carries the root shown under Verify.</p>
      )}
      <div className="iso-receipt__memo">
        <span className="iso-receipt__memolabel">Memo on every transaction</span>
        <span className="iso-mono">{memo}</span>
        <CopyId value={memo} label="the memo" />
      </div>
      <div>
        <h3 className="iso-receipt__group">Transactions</h3>
        <dl className="iso-idrows">
          {rows.map((r) => (
            <IdRow key={r.key} label={r.label} value={r.value} n={8} link={r.link} note={r.note} />
          ))}
        </dl>
      </div>
      {accounts.length > 0 ? (
        <div>
          <h3 className="iso-receipt__group">Accounts</h3>
          <dl className="iso-idrows">
            {accounts.map((a) => (
              <IdRow key={a.address} label={accountLabel(a.label)} value={a.address} n={6} link={a} />
            ))}
          </dl>
        </div>
      ) : null}
      {programs.length > 0 ? (
        <div>
          <h3 className="iso-receipt__group">Programs it calls</h3>
          <dl className="iso-idrows">
            {programs.map((p) => (
              <IdRow key={p.address} label={p.label} value={p.address} n={6} link={p} />
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
