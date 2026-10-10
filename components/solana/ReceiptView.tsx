'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { CorridorPayoutBundle } from '@/lib/solana-evidence/bundle';
import type { MerkleProof } from '@/lib/solana-evidence/merkle';
import { anchoredRootFromMemo, verifyBundle, type VerifyResult } from '@/lib/solana-evidence/verify';

import { api, copyText, dateShort, php, shortKey, timeShort, usd } from './client';
import type { ReceiptDTO } from './types';

const CHECK_TEXT: Record<string, string> = {
  bundle_shape: 'The record is a payout record (kind 3, version 1)',
  leaf: 'Recomputed this record’s fingerprint (leaf)',
  proof: 'Walked the Merkle path to a root',
  root_matches_anchor: 'The root matches the anchored root',
  count_matches_anchor: 'The batch size matches the anchor',
  period: 'The record falls inside the anchored period',
  simulated_label: 'A simulated anchor is labelled Simulated',
};

const TAMPERED_REFERENCE = 'MOCK-PESONET-20261011-0000BEEF';

export function ReceiptView({ id }: { id: string }) {
  const [receipt, setReceipt] = useState<ReceiptDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tamper, setTamper] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<{ receipt: ReceiptDTO }>(`/receipts/${id}`)
      .then((r) => setReceipt(r.receipt))
      .catch((e) => setError((e as Error).message));
  }, [id]);

  const bundle = useMemo(() => {
    if (!receipt) return null;
    const copy = structuredClone(receipt.bundle) as ReceiptDTO['bundle'];
    if (tamper) copy.bank.reference = TAMPERED_REFERENCE;
    return copy;
  }, [receipt, tamper]);

  if (error) {
    return (
      <div className="sx-narrow sx-stack">
        <h1>Receipt</h1>
        <div className="sx-notice sx-notice-error" role="alert">
          <p>{error}</p>
        </div>
        <Link href="/solana/pay">Back to payments</Link>
      </div>
    );
  }
  if (!receipt || !bundle) return <p className="sx-muted">Loading the receipt…</p>;
  const s = receipt.summary;

  function verify() {
    if (!receipt || !bundle) return;
    if (receipt.anchor.status !== 'anchored') {
      setResult({ ok: false, leafHex: receipt.leafHex, computedRootHex: null, anchoredRootHex: receipt.batch.rootHex, simulated: receipt.anchor.simulated, checks: [{ name: 'root_matches_anchor', passed: false, detail: 'The anchor is still pending.' }] });
      return;
    }
    // Runs entirely in this browser: canonical JSON → leaf → Merkle path → compare with the memo's root.
    const anchor = anchoredRootFromMemo(receipt.anchor.memo, { signature: receipt.anchor.signature ?? undefined, simulated: receipt.anchor.simulated });
    setResult(verifyBundle({ bundle: bundle as unknown as CorridorPayoutBundle, proof: receipt.proof as unknown as MerkleProof, anchor }));
  }

  return (
    <div className="sx-stack-lg">
      <div className="sx-row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Receipt</h1>
          <p className="sx-lede">
            {receipt.companyName} paid {s.supplierName}
          </p>
        </div>
        {receipt.simulated ? <span className="sx-pill sx-pill-sim">Simulated · devnet-ready</span> : <span className="sx-pill sx-pill-ok">Solana devnet</span>}
      </div>

      <section className="sx-card sx-stack" aria-labelledby="sum-title">
        <h2 id="sum-title" className="sx-visually-hidden">
          Summary
        </h2>
        <div>
          <p className="sx-big">{php(s.receivePhpMinor)}</p>
          <p className="sx-muted">Supplier received</p>
        </div>
        <dl className="sx-kv">
          <dt>Supplier</dt>
          <dd>
            {s.supplierName}, {s.bank} <span className="sx-mono">•••• {s.accountLast4}</span>
          </dd>
          <dt>Invoice</dt>
          <dd className="sx-mono">{s.invoiceNumber}</dd>
          <dt>Paid</dt>
          <dd>
            {dateShort(s.paidAt)} at {timeShort(s.paidAt)} by {s.partnerLabel}
          </dd>
          <dt>Bank reference</dt>
          <dd className="sx-mono">{s.bankReference}</dd>
          <dt>You paid</dt>
          <dd className="sx-num">{usd(s.youPayUsdcMinor)} from your Solana vault</dd>
          <dt>Rate</dt>
          <dd>
            {bundle.fx.rate} PHP per USDC <span className="sx-muted">({bundle.fx.reference})</span>
          </dd>
          <dt>Approved by</dt>
          <dd>
            {bundle.approvals.filter((a) => a.action === 'approve').map((a) => a.who).join(', ')} with device key{' '}
            <span className="sx-mono">{shortKey(bundle.approvals[0]?.keyPublic)}</span>
          </dd>
          <dt>Transfer</dt>
          <dd>
            {bundle.chain.signatures
              .filter((x) => x.purpose === 'squads_vault_execute')
              .map((x) => (
                <span key={x.signature} className="sx-mono" title={x.signature}>
                  {shortKey(x.signature, 8)} {x.simulated ? '(simulated)' : ''}
                </span>
              ))}
          </dd>
        </dl>
        <div className="sx-row">
          <a className="sx-btn" href={`/api/solana/receipts/${receipt.receiptId}/pack`} download>
            Download evidence pack
          </a>
          <button type="button" className="sx-btn sx-btn-ghost" onClick={async () => setCopied(await copyText(window.location.href))}>
            {copied ? 'Link copied' : 'Share with auditor'}
          </button>
        </div>
      </section>

      <section className="sx-card sx-stack" aria-labelledby="verify-title">
        <h2 id="verify-title">Verify this receipt</h2>
        <p className="sx-muted">
          Your browser recomputes this payment&rsquo;s fingerprint from the record, walks the Merkle path, and compares the result with the root anchored in a memo
          {receipt.anchor.simulated ? ' (in the simulator)' : ''}. Nothing is trusted from the server except the record itself.
        </p>
        <dl className="sx-kv">
          <dt>Anchor</dt>
          <dd>
            {receipt.anchor.status === 'anchored' ? (
              <>
                <span className="sx-hash">{receipt.anchor.memo}</span>
                <br />
                <span className="sx-small">
                  Memo transaction <span className="sx-mono">{shortKey(receipt.anchor.signature, 8)}</span>
                  {receipt.anchor.simulated ? ' (simulated)' : ''}
                  {receipt.anchor.explorerUrl ? (
                    <>
                      {' '}
                      <a href={receipt.anchor.explorerUrl} target="_blank" rel="noreferrer">
                        View on Solana Explorer
                      </a>
                    </>
                  ) : null}
                </span>
              </>
            ) : (
              'Recorded, anchor pending'
            )}
          </dd>
          <dt>Invoice commitment</dt>
          <dd className="sx-hash">{bundle.invoice.commitmentHex}</dd>
        </dl>
        <label className="sx-toggle">
          <input
            type="checkbox"
            checked={tamper}
            onChange={(e) => {
              setTamper(e.target.checked);
              setResult(null);
            }}
          />
          Tamper with a field (demo)
        </label>
        {tamper ? (
          <p className="sx-small">
            Changed the bank reference in this browser&rsquo;s copy from <span className="sx-mono">{receipt.bundle.bank.reference}</span> to{' '}
            <span className="sx-mono">{TAMPERED_REFERENCE}</span>.
          </p>
        ) : null}
        <div>
          <button type="button" className="sx-btn" onClick={verify}>
            Verify
          </button>
        </div>
        {result ? (
          <div aria-live="polite" className="sx-stack">
            <div className={`sx-notice ${result.ok ? 'sx-notice-ok' : 'sx-notice-error'}`}>
              <h3>{result.ok ? 'Verified. This record matches the anchored root.' : 'Does not verify. This record differs from what was anchored.'}</h3>
            </div>
            <ul className="sx-verify">
              {result.checks.map((c) => (
                <li key={c.name}>
                  <span aria-hidden="true" style={{ color: c.passed ? 'var(--ok)' : 'var(--error)', fontWeight: 700 }}>
                    {c.passed ? '✓' : '✕'}
                  </span>
                  <span>
                    {CHECK_TEXT[c.name] ?? c.name}
                    <span className="sx-visually-hidden">{c.passed ? ': passed' : ': not passed'}</span>
                    {c.name === 'leaf' && result.leafHex ? <span className="sx-hash" style={{ display: 'block' }}>{result.leafHex}</span> : null}
                    {c.name === 'root_matches_anchor' ? (
                      <span className="sx-hash" style={{ display: 'block' }}>
                        computed {result.computedRootHex ?? 'none'}
                        <br />
                        anchored {result.anchoredRootHex}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
