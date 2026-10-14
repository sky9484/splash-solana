// iso-ui
// copy: technical
'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { IsoButton, IsoDisplay, IsoSurface, Tag, TestModeBadge } from '@/components/iso';
import type { Wire } from '@/lib/solana-app/json';
import type { PayLinkView } from '@/lib/solana-app/requests';

type View = Wire<PayLinkView>;

/** US$ minor units (6 decimals) as people read them: "US$4,750.00". */
function usdText(minor: string): string {
  const cents = BigInt(minor) / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `US$${whole}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** What a wallet's amount box takes: "4750.00", no symbol, no grouping. */
function walletAmount(minor: string): string {
  const cents = BigInt(minor) / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function dateWords(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m!, 10) - 1] ?? m;
  return `${parseInt(d!, 10)} ${month} ${y}`;
}

function CopyRow({ label, value, shown }: { label: string; value: string; shown?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="iso-paypage__acct">
      <span className="iso-field__label">{label}</span>
      <div className="iso-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <code>{shown ?? value}</code>
        <button
          type="button"
          className="iso-tickbtn"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setDone(true);
              window.setTimeout(() => setDone(false), 2000);
            } catch {
              setDone(false);
            }
          }}
        >
          {done ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {done ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/**
 * The page someone else opens from a request's link (prompt 10 §6.3): who's asking, how much, by when,
 * and how to pay. The account shown is the requester's own Payments account and nothing else; the page
 * never shows a Splash address (tests/requests.test.mjs). "Pay by bank transfer" stays hidden until a
 * collection partner exists. This is the one page outside Settings with account details on it, inside
 * "Pay from a crypto wallet" (prompt 10 §0.6, the allowed zone).
 */
export function PayLink({ slug, view }: { slug: string; view: View }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const v = view;

  async function simulate() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/pay/${slug}/simulate`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? 'That didn’t go through. Try again.');
      router.refresh();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="iso iso-paypage">
      <div className="iso-paypage__in">
        <div className="iso-row" style={{ justifyContent: 'space-between' }}>
          <span className="iso-paypage__brand">
            <Image src="/splash-main-icon.png" alt="" width={30} height={30} />
            Splash
          </span>
          {v.testMode ? <TestModeBadge /> : null}
        </div>

        <IsoSurface hero className="iso-stack" aria-labelledby="pl-title">
          <h1 id="pl-title" className="iso-h2" style={{ margin: 0 }}>
            {v.requester.name} asks {v.payerName} to pay
          </h1>
          <IsoDisplay size="lg">{usdText(v.amountMinor)}</IsoDisplay>
          <dl className="iso-dl iso-dl--rows iso-num">
            <div>
              <dt>Invoice</dt>
              <dd className="iso-mono">{v.number}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>
                {dateWords(v.dueDate)}
                {v.overdueDays > 0 ? (
                  <>
                    {' '}
                    <Tag tone="amber">
                      Overdue · {v.overdueDays} {v.overdueDays === 1 ? 'day' : 'days'}
                    </Tag>
                  </>
                ) : null}
              </dd>
            </div>
            {v.lines.map((l, i) => (
              <div key={i}>
                <dt>{l.quantity === '1' ? l.description : `${l.description} × ${l.quantity}`}</dt>
                <dd>{usdText(l.amountMinor)}</dd>
              </div>
            ))}
            {v.myInvoisRef ? (
              <div>
                <dt>MyInvois reference</dt>
                <dd className="iso-mono">{v.myInvoisRef}</dd>
              </div>
            ) : null}
          </dl>
          {v.note ? <p className="iso-body" style={{ margin: 0 }}>{v.note}</p> : null}
          {v.paid ? (
            <Tag tone="ok" tick>
              Paid · thank you
            </Tag>
          ) : null}
        </IsoSurface>

        {!v.paid ? (
          <IsoSurface className="iso-stack" aria-labelledby="pl-wallet">
            <h2 id="pl-wallet" className="iso-h2" style={{ margin: 0 }}>
              Pay from a crypto wallet
            </h2>
            <p className="iso-body" style={{ margin: 0 }}>
              Send exactly <strong>{walletAmount(v.amountMinor)} USDC</strong> on {v.account.network} to {v.requester.name}&rsquo;s own account, with the reference in the memo. It lands in their account; Splash never holds it.
            </p>
            <CopyRow label={`${v.requester.name}’s account (${v.account.network})`} value={v.account.address} />
            <CopyRow label="Amount (USDC)" value={walletAmount(v.amountMinor)} />
            <CopyRow label="Reference (memo)" value={v.reference} />
            <p className="iso-small" style={{ margin: 0 }}>
              Only USDC on {v.account.network}, to this account. A different amount, or no reference, won&rsquo;t match this request; {v.requester.name} would then match it by hand.
              {v.account.cluster !== 'mainnet-beta' ? ' This account is on Solana devnet: test money only.' : ''}
            </p>
            {v.simulator ? (
              <div className="iso-stack" style={{ gap: 8 }}>
                <div>
                  <IsoButton variant="primary" busy={busy} onClick={() => void simulate()}>
                    {busy ? 'Paying…' : 'Pay it in test mode'}
                  </IsoButton>
                </div>
                <p className="iso-small" style={{ margin: 0 }}>
                  Test mode: no real money moves. This sends the exact amount, with the reference, from a test wallet.
                </p>
              </div>
            ) : null}
            {problem ? (
              <p className="iso-note iso-note--danger" role="alert">
                {problem}
              </p>
            ) : null}
          </IsoSurface>
        ) : null}

        <p className="iso-small" style={{ margin: 0 }}>
          Splash is the software in between: the money goes straight to {v.requester.name}&rsquo;s own account, and a person there sees it arrive.
        </p>
      </div>
    </main>
  );
}
