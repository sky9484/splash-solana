'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { CorridorPayoutBundle } from '@/lib/solana-evidence/bundle';
import type { MerkleProof } from '@/lib/solana-evidence/merkle';
import { anchoredRootFromMemo, verifyBundle, type VerifyResult } from '@/lib/solana-evidence/verify';

import { api, copyText, dateShort, php, shareReceiptLink, shortKey, timeShort, usd } from './client';
import { SolscanTrace } from './SolscanTrace';
import type { ReceiptDTO } from './types';

const TAMPERED_REFERENCE = 'MOCK-PESONET-20261011-0000BEEF';

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
    if (tamper) copy.bank.reference = TAMPERED_REFERENCE;
    return copy;
  }, [receipt, tamper]);

  if (error) {
    return (
      <div className="sx-narrow sx-stack">
        {showTitle ? <h1>Receipt</h1> : null}
        <div className="sx-notice sx-notice-error" role="alert">
          <p>{error}</p>
        </div>
        {source.kind === 'company' ? <Link href="/dashboard/history">Back to payments</Link> : null}
      </div>
    );
  }
  if (!receipt || !bundle) return <p className="sx-muted">Loading the receipt…</p>;
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
        detail: result?.leafHex ? <span className="sx-hash">{result.leafHex}</span> : 'The record is not anchored yet.',
      },
      {
        key: 'path',
        title: 'Walk the Merkle path to the batch root',
        state: result ? (passed(['proof']) ? 'pass' : 'fail') : 'skip',
        detail: result ? <span className="sx-hash">{result.computedRootHex ?? 'no root'}</span> : 'The record is not anchored yet.',
      },
      {
        key: 'anchor',
        title: onDevnet ? 'Read the anchor on Solana' : 'Read the anchor (in the simulator)',
        state: result ? (passed(['root_matches_anchor', 'count_matches_anchor', 'period', 'blob_ids', 'simulated_label']) ? 'pass' : 'fail') : 'skip',
        detail: result ? (
          <>
            Anchored root <span className="sx-hash">{result.anchoredRootHex}</span>
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
                  View on Solscan
                </a>
              </>
            ) : null}
          </>
        ) : (
          'The anchor is still pending.'
        ),
      },
    ];
    // The stored copy: hash what the store returns now and compare with what was recorded at storage.
    try {
      const { blob } = await api<{ blob: { ciphertext: string | null; ciphertextSha256Hex: string; mode: string; blobId: string } }>(p.blob);
      if (!blob.ciphertext) {
        out.push({ key: 'blob', title: 'Check the stored copy', state: 'skip', detail: blob.mode === 'memory' ? 'The offline store empties when the demo server restarts, so this copy is gone. On devnet the copy is on Walrus.' : 'The store did not return this copy right now. Try again.' });
      } else {
        const hex = await sha256Hex(blob.ciphertext);
        out.push({
          key: 'blob',
          title: blob.mode === 'memory' ? 'Check the stored copy (offline store)' : 'Check the stored copy on Walrus',
          state: hex === blob.ciphertextSha256Hex ? 'pass' : 'fail',
          detail: (
            <>
              sha256 <span className="sx-hash">{hex}</span>
              {hex === blob.ciphertextSha256Hex ? ' matches the hash recorded when it was stored.' : ` differs from the recorded ${blob.ciphertextSha256Hex}.`}
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

  return (
    <div className="sx-stack-lg">
      <div className="sx-row" style={{ justifyContent: 'space-between' }}>
        <div>
          {showTitle ? <h1>Receipt</h1> : null}
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
          <dt>{source.kind === 'company' ? 'You paid' : 'Paid from'}</dt>
          <dd className="sx-num">{usd(s.youPayUsdcMinor)} from the company’s Solana vault</dd>
          <dt>Rate</dt>
          <dd>
            {bundle.fx.rate} PHP per USDC <span className="sx-muted">({bundle.fx.reference})</span>
          </dd>
          <dt>Approved by</dt>
          <dd>
            {[...new Set(bundle.approvals.filter((a) => a.action === 'approve').map((a) => a.who))].join(', ')} with device key{' '}
            <span className="sx-mono">{shortKey(bundle.approvals[0]?.keyPublic)}</span>
          </dd>
        </dl>
        <div className="sx-row">
          <a className="sx-btn" href={p.pack} download>
            Download evidence pack
          </a>
          {source.kind === 'company' ? (
            <button
              type="button"
              className="sx-btn sx-btn-ghost"
              onClick={async () => {
                try {
                  setShared((await copyText(await shareReceiptLink(source.id))) ? 'copied' : 'failed');
                } catch {
                  setShared('failed');
                }
              }}
            >
              {shared === 'copied' ? 'Auditor link copied' : 'Share with auditor'}
            </button>
          ) : null}
        </div>
        {shared === 'copied' ? <p className="sx-small sx-muted">The link opens this receipt only, with its checks and the evidence pack. No sign-in.</p> : null}
        {shared === 'failed' ? (
          <p className="sx-small" role="alert">
            The link could not be made or copied. Try again.
          </p>
        ) : null}
      </section>

      <SolscanTrace
        auditor={source.kind === 'shared'}
        memo={receipt.trace.memo}
        transactions={receipt.signatures}
        accounts={receipt.trace.accounts}
        anchor={receipt.anchor.signature ? { signature: receipt.anchor.signature, simulated: receipt.anchor.simulated, solscanUrl: receipt.anchor.solscanUrl, explorerUrl: receipt.anchor.explorerUrl } : null}
      />

      <section className="sx-card sx-stack" aria-labelledby="verify-title">
        <h2 id="verify-title">Verify this receipt</h2>
        <p className="sx-muted">Five checks, run in this browser. The server supplies the record; it does not supply the answer.</p>
        <dl className="sx-kv">
          <dt>Anchor memo</dt>
          <dd className="sx-hash">{receipt.anchor.status === 'anchored' ? receipt.anchor.memo : 'Recorded, anchor pending'}</dd>
          <dt>Invoice commitment</dt>
          <dd className="sx-hash">{bundle.invoice.commitmentHex}</dd>
          <dt>Stored copy</dt>
          <dd>
            <span className="sx-mono">{shortKey(receipt.stored.blobId, 10)}</span>{' '}
            <span className="sx-muted sx-small">
              ({receipt.stored.mode === 'memory' ? 'offline store' : 'Walrus'}, {receipt.stored.sizeBytes} bytes, sealed)
            </span>
          </dd>
        </dl>
        <label className="sx-toggle">
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
          <p className="sx-small">
            Changed the bank reference in this browser&rsquo;s copy from <span className="sx-mono">{receipt.bundle.bank.reference}</span> to{' '}
            <span className="sx-mono">{TAMPERED_REFERENCE}</span>.
          </p>
        ) : null}
        <div>
          <button type="button" className="sx-btn" onClick={verify} disabled={checking}>
            {checking ? 'Checking…' : 'Verify'}
          </button>
        </div>
        {steps ? (
          <div aria-live="polite" className="sx-stack">
            <div className={`sx-notice ${failed || !verdict?.ok ? 'sx-notice-error' : 'sx-notice-ok'}`}>
              <h3>{failed || !verdict?.ok ? 'Does not verify. This record differs from what was anchored or stored.' : 'Verified. This record matches the anchored root and the stored copy.'}</h3>
            </div>
            <ol className="sx-verify">
              {steps.map((st) => (
                <li key={st.key}>
                  <span aria-hidden="true" className={`sx-check-mark sx-check-${st.state}`}>
                    {st.state === 'pass' ? '✓' : st.state === 'fail' ? '✕' : '–'}
                  </span>
                  <span>
                    <strong>{st.title}</strong>
                    <span className="sx-visually-hidden">{st.state === 'pass' ? ': passed' : st.state === 'fail' ? ': failed' : ': not run'}</span>
                    <span className="sx-small sx-muted" style={{ display: 'block', overflowWrap: 'anywhere' }}>
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
