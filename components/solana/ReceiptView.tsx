'use client';
// iso-ui

import Link from 'next/link';
import { Check, Download, Minus, Printer, Share2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { TestModeBadge } from '@/components/iso';

import type { CorridorPayoutBundle } from '@/lib/solana-evidence/bundle';
import type { MerkleProof } from '@/lib/solana-evidence/merkle';
import { anchoredRootFromMemo, verifyBundle, type VerifyResult } from '@/lib/solana-evidence/verify';

import { api, copyText, dateShort, php, shareReceiptLink, shortKey, timeShort, usd } from './client';
import { SolscanTrace } from './SolscanTrace';
import type { ReceiptDTO } from './types';

const TAMPERED_REFERENCE = 'MOCK-PESONET-20261011-0000BEEF';

/* A treasury order's words. T-bills are subscribed and redeemed; stocks are bought and sold. */
const ORDER_NAME = { subscribe: 'Subscribe', redeem: 'Redeem', buy: 'Buy', sell: 'Sell' } as const;
const ORDER_PAST = { subscribe: 'subscribed to', redeem: 'redeemed', buy: 'bought', sell: 'sold' } as const;
const LANDS_IN = {
  investments: 'Into your Investments account',
  payments: 'Into your Payments account',
  bank_wire: 'By bank wire to your company’s bank account, outside Splash',
} as const;
/** Millionths of a unit, as a string on the wire, to two decimals (rounded down). */
function unitsText(unitsMicro: string): string {
  const hundredths = BigInt(unitsMicro) / 10_000n;
  return `${(hundredths / 100n).toLocaleString('en-US')}.${(hundredths % 100n).toString().padStart(2, '0')}`;
}

/** Whose receipt this is: the signed-in company's own, or one opened from an auditor's share link. */
export type ReceiptSource = { kind: 'company'; id: string } | { kind: 'shared'; token: string };

type StepState = 'pass' | 'fail' | 'skip';
type Step = { key: string; title: string; state: StepState; detail: React.ReactNode };

const paths = (s: ReceiptSource) =>
  s.kind === 'company'
    ? { read: `/receipts/${s.id}`, blob: `/receipts/${s.id}/blob`, pack: `/api/solana/receipts/${s.id}/pack` }
    : { read: `/shared/${s.token}`, blob: `/shared/${s.token}/blob`, pack: `/api/solana/shared/${s.token}/pack` };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A receipt and the five checks prompt 07 §4.5 asks for, each shown pass, fail or not run with the reason:
 * the leaf, the Merkle path, the anchor on Solana, the stored copy's sha256, and Seal decryption.
 * Everything runs in this browser; the server supplies the record, never a verdict.
 */
export function ReceiptView({ source, showTitle = false }: { source: ReceiptSource; showTitle?: boolean }) {
  const [receipt, setReceipt] = useState<ReceiptDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tamper, setTamper] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [verdict, setVerdict] = useState<VerifyResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [shared, setShared] = useState<'idle' | 'copied' | 'failed'>('idle');
  const p = paths(source);

  useEffect(() => {
    api<{ receipt: ReceiptDTO }>(p.read)
      .then((r) => setReceipt(r.receipt))
      .catch((e) => setError((e as Error).message));
  }, [p.read]);

  const bundle = useMemo(() => {
    if (!receipt) return null;
    const copy = structuredClone(receipt.bundle) as ReceiptDTO['bundle'];
    if (tamper) {
      // A bank payout: change the bank reference. A payment to (or from) a Splash account: change who was
      // paid. A treasury order: change who approved it.
      if (copy.kindName === 'corridor_payout') copy.bank.reference = TAMPERED_REFERENCE;
      else if (copy.kindName === 'treasury') copy.approval.who = `${copy.approval.who} (edited)`;
      else copy.payee.name = `${copy.payee.name} (edited)`;
    }
    return copy;
  }, [receipt, tamper]);

  if (error) {
    return (
      <div className="iso-receipt iso-stack">
        {showTitle ? <h1 className="iso-title">Receipt</h1> : null}
        <p className="iso-note iso-note--danger" role="alert">
          {error}
        </p>
        {source.kind === 'company' ? <Link href="/dashboard/history">Back to payments</Link> : null}
      </div>
    );
  }
  if (!receipt || !bundle) return <p className="iso-small">Loading the receipt…</p>;
  const s = receipt.summary;
  const onDevnet = !receipt.simulated;

  async function verify() {
    if (!receipt || !bundle) return;
    setChecking(true);
    const anchored = receipt.anchor.status === 'anchored';
    const result = anchored
      ? verifyBundle({
          bundle: bundle as unknown as CorridorPayoutBundle,
          proof: receipt.proof as unknown as MerkleProof,
          anchor: anchoredRootFromMemo(receipt.anchor.memo, { signature: receipt.anchor.signature ?? undefined, simulated: receipt.anchor.simulated }),
        })
      : null;
    // A step passes when every check it groups that was run passed. Some run only when the anchor
    // carries them (a memo anchor has no period; only a v2 SAS anchor binds the Walrus blob ids).
    const passed = (names: string[]) => {
      const run = result ? result.checks.filter((c) => names.includes(c.name)) : [];
      return run.length > 0 && run.every((c) => c.passed);
    };
    const out: Step[] = [
      {
        key: 'leaf',
        title: 'Recompute this payment’s fingerprint (leaf)',
        state: result ? (passed(['bundle_shape', 'leaf']) ? 'pass' : 'fail') : 'skip',
        detail: result?.leafHex ? <span className="iso-mono iso-receipt__hash">{result.leafHex}</span> : 'The proof isn’t recorded yet.',
      },
      {
        key: 'path',
        title: 'Check it belongs to the day’s proof',
        state: result ? (passed(['proof']) ? 'pass' : 'fail') : 'skip',
        detail: result ? <span className="iso-mono iso-receipt__hash">{result.computedRootHex ?? 'no root'}</span> : 'The proof isn’t recorded yet.',
      },
      {
        key: 'anchor',
        title: onDevnet ? 'Read the recorded proof' : 'Read the recorded proof (in test mode)',
        state: result ? (passed(['root_matches_anchor', 'count_matches_anchor', 'period', 'blob_ids', 'simulated_label']) ? 'pass' : 'fail') : 'skip',
        detail: result ? (
          <>
            Recorded proof <span className="iso-mono iso-receipt__hash">{result.anchoredRootHex}</span>
            {result.checks
              .filter((c) => ['root_matches_anchor', 'count_matches_anchor', 'period', 'blob_ids', 'simulated_label'].includes(c.name) && !c.passed)
              .map((c) => (
                <span key={c.name} style={{ display: 'block' }}>
                  {c.detail}.
                </span>
              ))}
            {receipt.anchor.solscanUrl ? (
              <>
                {' '}
                <a href={receipt.anchor.solscanUrl} target="_blank" rel="noreferrer">
                  Open its record
                </a>
              </>
            ) : null}
          </>
        ) : (
          'The proof is still being recorded.'
        ),
      },
    ];
    // The stored copy: hash what the store returns now and compare with what was recorded at storage.
    try {
      const { blob } = await api<{ blob: { ciphertext: string | null; ciphertextSha256Hex: string; mode: string; blobId: string } }>(p.blob);
      if (!blob.ciphertext) {
        out.push({ key: 'blob', title: 'Check the stored copy', state: 'skip', detail: blob.mode === 'memory' ? 'The offline store empties when the demo server restarts, so this copy is gone. Outside offline test mode the copy is kept on Walrus.' : 'The store did not return this copy right now. Try again.' });
      } else {
        const hex = await sha256Hex(blob.ciphertext);
        out.push({
          key: 'blob',
          title: blob.mode === 'memory' ? 'Check the stored copy (offline store)' : 'Check the stored copy on Walrus',
          state: hex === blob.ciphertextSha256Hex ? 'pass' : 'fail',
          detail: (
            <>
              sha256 <span className="iso-mono iso-receipt__hash">{hex}</span>
              {hex === blob.ciphertextSha256Hex ? ' matches the fingerprint recorded when it was stored.' : ` differs from the recorded ${blob.ciphertextSha256Hex}.`}
            </>
          ),
        });
      }
    } catch (e) {
      out.push({ key: 'blob', title: 'Check the stored copy', state: 'skip', detail: (e as Error).message });
    }
    out.push({
      key: 'seal',
      title: 'Decrypt it here with Seal',
      state: 'skip',
      detail: onDevnet
        ? 'Seal decryption in the browser needs the evidence access policy, which is not published yet (gate G1). Nothing is decrypted on the server.'
        : 'Offline the record is sealed with a stand-in key on this demo server, not Seal, so there is nothing for this browser to decrypt. Splash keeps no readable copy once it is sealed.',
    });
    setVerdict(result);
    setSteps(out);
    setChecking(false);
  }

  const failed = steps?.some((x) => x.state === 'fail') ?? false;
  const recorded = receipt.anchor.status === 'anchored';
  const paidWord = s.kind === 'receivable' ? 'Received' : s.kind === 'treasury' ? 'Settled' : 'Paid';
  const amount = s.kind === 'bank' ? php(s.receivePhpMinor) : usd(s.receiveUsdMinor);
  const lede =
    s.kind === 'receivable'
      ? `${s.supplierName} paid ${receipt.companyName}`
      : s.kind === 'treasury'
        ? `${receipt.companyName} ${ORDER_PAST[s.treasury.orderKind]} ${s.supplierName}`
        : `${receipt.companyName} paid ${s.supplierName}`;
  const sub =
    s.kind === 'treasury'
      ? LANDS_IN[s.treasury.landsIn]
      : s.kind === 'receivable'
        ? 'Into your Payments account'
        : s.kind === 'peer'
          ? `Into ${s.supplierName}’s Splash account`
          : `${s.supplierName} received`;
  const approvers =
    bundle.kindName === 'treasury'
      ? { who: bundle.approval.who, key: bundle.approval.keyPublic }
      : bundle.kindName !== 'receivable'
        ? { who: [...new Set(bundle.approvals.filter((a) => a.action === 'approve').map((a) => a.who))].join(', '), key: bundle.approvals[0]?.keyPublic ?? null }
        : null;

  return (
    <div className="iso-receipt">
      {showTitle ? <h1 className="iso-title">Receipt</h1> : null}

      {/* ── The receipt: what moved, to whom, when, for how much, and who approved it ── */}
      <section className="iso-surface iso-receipt__main" aria-labelledby="rcpt-amount">
        <div className="iso-receipt__head">
          <span className="iso-receipt__status">
            <span className="iso-receipt__tick" aria-hidden="true">
              <Check size={16} strokeWidth={3} />
            </span>
            {paidWord} · {recorded ? 'proof recorded' : 'proof being recorded'}
          </span>
          <TestModeBadge inline label={receipt.simulated ? 'Test mode · simulated' : 'Test mode'} />
        </div>
        <p className="iso-receipt__lede">{lede}</p>
        <p id="rcpt-amount" className="iso-receipt__amount iso-num">
          {amount}
        </p>
        <p className="iso-receipt__sub">
          {sub}
          {s.paidAt ? (
            <>
              {' '}
              · {dateShort(s.paidAt)}, {timeShort(s.paidAt)}
            </>
          ) : null}
        </p>

        <dl className="iso-receipt__rows">
          {s.kind === 'treasury' ? (
            <>
              <Row label="Order">
                {ORDER_NAME[s.treasury.orderKind]} · {s.supplierName}
                {s.treasury.sweep ? ' · from your sweep rule' : ''}
              </Row>
              <Row label="How">{s.treasury.path === 'ondo' ? 'Straight from Ondo' : 'On the market'}</Row>
              <Row label="Units" num>
                {unitsText(s.treasury.unitsMicro)} at a test price
              </Row>
              {s.treasury.holdUntil ? <Row label="Held until">{dateShort(s.treasury.holdUntil)}</Row> : null}
            </>
          ) : s.kind === 'receivable' ? (
            <>
              <Row label="Paid by">{s.supplierName}</Row>
              <Row label="Your request" mono>
                {s.invoiceNumber}
              </Row>
              <Row label="Matched">{s.matchedBy === 'splash_payment' ? 'A payment on Splash for this request' : 'By the reference and the exact amount'}</Row>
            </>
          ) : s.kind === 'peer' ? (
            <>
              <Row label="Paid to">{s.supplierName}, a business on Splash</Row>
              <Row label="Reference" mono>
                {s.invoiceNumber}
              </Row>
              {s.note ? <Row label="Note">{s.note}</Row> : null}
              <Row label={source.kind === 'company' ? 'You paid' : 'Paid from'} num>
                {usd(s.youPayUsdcMinor)}, no conversion and no Splash fee
              </Row>
            </>
          ) : (
            <>
              <Row label="Paid to">
                {s.supplierName}, {s.bank} <span className="iso-mono">•••• {s.accountLast4}</span>
              </Row>
              <Row label="Invoice" mono>
                {s.invoiceNumber}
              </Row>
              <Row label={source.kind === 'company' ? 'You paid' : 'Paid from'} num>
                {usd(s.youPayUsdcMinor)} from the company’s Payments account
              </Row>
              {bundle.kindName === 'corridor_payout' ? (
                <Row label="Exchange rate" num>
                  {bundle.fx.rate} PHP per US$ <span className="iso-muted">({bundle.fx.reference})</span>
                </Row>
              ) : null}
              <Row label="Paid out by">{s.partnerLabel}</Row>
              <Row label="Bank reference" mono>
                {s.bankReference}
              </Row>
            </>
          )}
          {approvers ? (
            <Row label="Approved by">
              {approvers.who}, on their device · key <span className="iso-mono">{shortKey(approvers.key)}</span>
            </Row>
          ) : null}
        </dl>

        <div className="iso-receipt__actions">
          <a className="iso-btn iso-btn--primary" href={p.pack} download>
            <Download size={16} aria-hidden="true" />
            Download evidence pack
          </a>
          {source.kind === 'company' ? (
            <button
              type="button"
              className="iso-btn iso-btn--quiet"
              onClick={async () => {
                try {
                  setShared((await copyText(await shareReceiptLink(source.id))) ? 'copied' : 'failed');
                } catch {
                  setShared('failed');
                }
              }}
            >
              <Share2 size={16} aria-hidden="true" />
              {shared === 'copied' ? 'Auditor link copied' : 'Share with auditor'}
            </button>
          ) : null}
          <button type="button" className="iso-btn iso-btn--quiet" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" />
            Print
          </button>
        </div>
        {shared === 'copied' ? <p className="iso-small">The link opens this receipt only, with its checks and the evidence pack. No sign-in.</p> : null}
        {shared === 'failed' ? (
          <p className="iso-small" role="alert">
            The link could not be made or copied. Try again.
          </p>
        ) : null}
      </section>

      <SolscanTrace
        auditor={source.kind === 'shared'}
        memo={receipt.trace.memo}
        transactions={receipt.signatures}
        accounts={receipt.trace.accounts}
        programs={receipt.programs}
        anchor={receipt.anchor.signature ? { signature: receipt.anchor.signature, simulated: receipt.anchor.simulated, solscanUrl: receipt.anchor.solscanUrl, explorerUrl: receipt.anchor.explorerUrl } : null}
      />

      {/* ── Verify: five checks, run in this browser (a receipt's Technical details, §0.6) ── */}
      <section className="iso-surface iso-surface--pad iso-stack iso-receipt__tech" aria-labelledby="verify-title">
        <div>
          <p className="iso-receipt__kicker">Technical details</p>
          <h2 id="verify-title" className="iso-h2">
            Verify this receipt
          </h2>
        </div>
        <p className="iso-small">Five checks, run in this browser. The server supplies the record; it does not supply the answer.</p>
        <dl className="iso-idrows">
          <div className="iso-idrow">
            <dt>Recorded proof</dt>
            <dd>
              <span className="iso-idrow__value iso-mono iso-receipt__hash">{recorded ? receipt.anchor.memo : 'Saved; the proof is still being recorded'}</span>
            </dd>
          </div>
          <div className="iso-idrow">
            <dt>{bundle.kindName === 'peer_transfer' ? 'Reference commitment' : bundle.kindName === 'receivable' ? 'Request commitment' : bundle.kindName === 'treasury' ? 'Approved order (sha256)' : 'Invoice commitment'}</dt>
            <dd>
              <span className="iso-idrow__value iso-mono iso-receipt__hash">
                {bundle.kindName === 'peer_transfer' ? bundle.reference.commitmentHex : bundle.kindName === 'receivable' ? bundle.request.commitmentHex : bundle.kindName === 'treasury' ? bundle.approval.messageSha256 : bundle.invoice.commitmentHex}
              </span>
            </dd>
          </div>
          <div className="iso-idrow">
            <dt>Stored copy</dt>
            <dd>
              <span className="iso-idrow__value iso-mono">{shortKey(receipt.stored.blobId, 10)}</span>
              <span className="iso-idrow__note">
                {receipt.stored.mode === 'memory' ? 'offline store' : 'Walrus'}, {receipt.stored.sizeBytes} bytes, sealed
              </span>
            </dd>
          </div>
        </dl>
        <label className="iso-receipt__tamper">
          <input
            type="checkbox"
            checked={tamper}
            onChange={(e) => {
              setTamper(e.target.checked);
              setSteps(null);
              setVerdict(null);
            }}
          />
          Tamper with a field (demo)
        </label>
        {tamper ? (
          <p className="iso-small">
            {receipt.bundle.kindName === 'treasury' ? (
              <>Changed who approved it in this browser&rsquo;s copy to &ldquo;{receipt.bundle.approval.who} (edited)&rdquo;.</>
            ) : receipt.bundle.kindName !== 'corridor_payout' ? (
              <>Changed who was paid in this browser&rsquo;s copy to &ldquo;{receipt.bundle.payee.name} (edited)&rdquo;.</>
            ) : (
              <>
                Changed the bank reference in this browser&rsquo;s copy from <span className="iso-mono">{receipt.bundle.bank.reference}</span> to <span className="iso-mono">{TAMPERED_REFERENCE}</span>.
              </>
            )}
          </p>
        ) : null}
        <div>
          <button type="button" className="iso-btn iso-btn--primary" onClick={verify} disabled={checking}>
            {checking ? 'Checking…' : 'Verify'}
          </button>
        </div>
        {steps ? (
          <div aria-live="polite" className="iso-stack">
            <div className={`iso-note ${failed || !verdict?.ok ? 'iso-note--danger' : 'iso-note--ok'}`}>
              <h3 className="iso-receipt__verdict">{failed || !verdict?.ok ? 'Does not verify. This record differs from the recorded proof or the stored copy.' : 'Verified. This record matches the recorded proof and the stored copy.'}</h3>
            </div>
            <ol className="iso-receipt__checks">
              {steps.map((st) => (
                <li key={st.key} data-state={st.state}>
                  <span aria-hidden="true" className="iso-receipt__mark">
                    {st.state === 'pass' ? <Check size={14} strokeWidth={3} /> : st.state === 'fail' ? <X size={14} strokeWidth={3} /> : <Minus size={14} strokeWidth={3} />}
                  </span>
                  <span>
                    <strong>{st.title}</strong>
                    <span className="iso-sr">{st.state === 'pass' ? ': passed' : st.state === 'fail' ? ': failed' : ': not run'}</span>
                    <span className="iso-receipt__detail">
                      {st.state === 'skip' ? 'Not run. ' : null}
                      {st.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** One line of the receipt: a label, and its value (in figures or in mono where it is a reference). */
function Row({ label, children, mono = false, num = false }: { label: string; children: React.ReactNode; mono?: boolean; num?: boolean }) {
  return (
    <div className="iso-receipt__row">
      <dt>{label}</dt>
      <dd className={mono ? 'iso-mono' : num ? 'iso-num' : undefined}>{children}</dd>
    </div>
  );
}
