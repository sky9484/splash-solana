// iso-ui
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Check, Upload, X } from 'lucide-react';

import { Combobox, Field, IsoButton, IsoSurface, Tag, type TagTone } from '@/components/iso';

import { parseSupplierRows, SAMPLE_BATCH_CSV } from '@/lib/solana-app/batch-rows';
import type { Wire } from '@/lib/solana-app/json';
import type { batchView, listBatches } from '@/lib/solana-app/batch-service';

import { clock, secondsLeft } from './ApprovalCard';
import { api, ApiError, dateShort, existingDeviceKey, php, shortKey, signPrepared, usd, usdExact } from './client';
import { notifyCompanyChanged, useCompany } from './useCompany';

type BatchDTO = Wire<ReturnType<typeof batchView>>;
type BatchSummaryDTO = Wire<ReturnType<typeof listBatches>>[number];

const BYTES = 1232;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const REHEARSALS = [
  { value: 'none', label: 'No problem: the normal path' },
  { value: 'drop_chunk', label: 'One chunk’s transfer does not land' },
];

/** The batch's rows as integers, as written (no rounding, no floats), for the ledger. Same shape as History's. */
function batchCsv(batch: BatchDTO): string {
  const head = ['batch_id', 'line', 'supplier', 'bank', 'account_last4', 'invoice', 'amount_php_minor', 'you_pay_usdc_minor', 'splash_fee_usdc_minor', 'chunk', 'status', 'bank_reference', 'deposit_address'];
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const rows = batch.rows.map((r) =>
    [batch.id, r.line, r.supplierName, r.bank, r.accountLast4, r.invoiceNumber, r.amountPhpMinor, r.youPayUsdcMinor, r.splashFeeMinor, r.chunkIndex === null ? null : r.chunkIndex + 1, r.status, r.bankReference, r.depositAddress].map(cell).join(','),
  );
  return [head.join(','), ...rows].join('\n');
}

function downloadCsv(batch: BatchDTO) {
  const url = URL.createObjectURL(new Blob([batchCsv(batch)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `splash-${batch.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const rowTone = (s: string): TagTone => (s === 'paid' ? 'ok' : s === 'returned' || s === 'not_sent' ? 'danger' : 'ink');
const chunkTone = (s: string): TagTone => (s === 'confirmed' ? 'ok' : s === 'failed' || s === 'not_sent' ? 'danger' : 'ink');

/**
 * Batch payouts (prompt 07 §5.5, §6.2): a supplier file becomes chunks sized to fit a Solana
 * transaction; one approval on this device signs every chunk; each chunk pays all its suppliers or
 * none, and a failed chunk is retried on its own. The screen says that plainly, because "all or
 * nothing" is not true of a batch on Solana.
 */
export function BatchFlow({ batchId }: { batchId?: string | null }) {
  const router = useRouter();
  const { state } = useCompany();
  const [batch, setBatch] = useState<BatchDTO | null>(null);
  const [recent, setRecent] = useState<BatchSummaryDTO[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rehearsal, setRehearsal] = useState<'none' | 'drop_chunk'>('none');
  const now = useNow(batch?.state === 'quoted');
  const preview = useMemo(() => (text.trim() ? parseSupplierRows(text) : null), [text]);

  useEffect(() => {
    if (batchId) {
      api<{ batch: BatchDTO }>(`/batches/${batchId}`)
        .then((r) => setBatch(r.batch))
        .catch((e) => setError({ code: e instanceof ApiError ? e.code : 'error', message: (e as Error).message }));
    }
    api<{ batches: BatchSummaryDTO[] }>('/batches')
      .then((r) => setRecent(r.batches))
      .catch(() => setRecent([]));
  }, [batchId]);

  if (state.status === 'loading') {
    return (
      <div className="iso-stack" aria-busy="true" aria-label="Loading your company">
        <span className="iso-skel" style={{ height: 180 }} />
      </div>
    );
  }
  if (state.status !== 'ready' || !state.company.vault) {
    return (
      <IsoSurface className="iso-stack">
        <p className="iso-body" style={{ margin: 0 }}>
          {state.status === 'ready' ? 'Set up this device and your accounts first.' : state.message}
        </p>
        <div>
          <IsoButton variant="primary" href={state.status === 'signin' ? '/login' : '/dashboard/setup'}>
            {state.status === 'signin' ? 'Sign in' : 'Set up this device'}
          </IsoButton>
        </div>
      </IsoSurface>
    );
  }
  const company = state.company;
  const offline = company.mode === 'offline';

  const fail = (e: unknown) => setError({ code: e instanceof ApiError ? e.code : 'error', message: e instanceof Error ? e.message : String(e) });

  async function quote(body: { csv?: string; sample?: boolean }) {
    setBusy('quote');
    setError(null);
    try {
      const r = await api<{ batch: BatchDTO }>('/batches', { body });
      setBatch(r.batch);
      router.replace(`/dashboard/batch?batch=${r.batch.id}`, { scroll: false });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function approve(chunk?: number) {
    if (!batch) return;
    setBusy(chunk === undefined ? 'approve' : `retry-${chunk}`);
    setError(null);
    try {
      if (!company.me.canApprove) throw new ApiError('not_an_approver', "This device can't approve for your company yet. Finish setup on it.", 0);
      if (!(await existingDeviceKey(company.me.keyId))) throw new ApiError('no_device_key', "This browser doesn't hold this device's approval key. Approve from the browser where you set up this device.", 0);
      const prepared = await api<{ messages: Array<{ id: string; messageBase64: string }> }>(`/batches/${batch.id}/prepare`, { body: chunk === undefined ? { rehearsal } : { chunk } });
      const signatures = await signPrepared(company.me.keyId, prepared.messages);
      const r = await api<{ batch: BatchDTO }>(`/batches/${batch.id}/approve`, { body: { signatures } });
      setBatch(r.batch);
      notifyCompanyChanged();
    } catch (e) {
      fail(e);
      try {
        setBatch((await api<{ batch: BatchDTO }>(`/batches/${batch.id}`)).batch);
      } catch {
        /* keep what is shown */
      }
    } finally {
      setBusy(null);
    }
  }

  const problem = error ? (
    <p className="iso-note iso-note--danger" role="alert">
      {error.message}
    </p>
  ) : null;

  /* ------------------------------------------------------------ start */
  if (!batch) {
    const blocker = !preview ? 'Paste the rows or choose a file first.' : preview.rows.length === 0 ? 'No supplier rows were read yet.' : preview.errors.length > 0 ? 'Fix the rows above first.' : null;
    return (
      <>
        <div className="iso-grid-2 iso-batch__start iso-rise iso-rise-2">
          <IsoSurface className="iso-stack" aria-labelledby="bt-file">
            <h2 id="bt-file" className="iso-h2">
              Upload a supplier file
            </h2>
            <p className="iso-small" style={{ margin: 0 }}>
              CSV with columns supplier, bank, account, amount (pesos), invoice. Only the last four account digits are kept.
            </p>
            <div>
              <label className="iso-btn iso-btn--quiet iso-batch__file">
                <Upload size={16} aria-hidden="true" /> Choose a CSV file
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="iso-sr"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setText(await f.text());
                  }}
                />
              </label>
            </div>
          </IsoSurface>
          <IsoSurface className="iso-stack" aria-labelledby="bt-sample">
            <h2 id="bt-sample" className="iso-h2">
              Use the sample batch
            </h2>
            <p className="iso-small" style={{ margin: 0 }}>
              Twelve fictional suppliers in the Philippines, from ₱5,200 to ₱64,300.
            </p>
            <div>
              <IsoButton variant="primary" busy={busy === 'quote'} disabled={busy !== null} onClick={() => void quote({ sample: true })}>
                {busy === 'quote' ? 'Quoting…' : 'Quote the sample batch'}
              </IsoButton>
            </div>
          </IsoSurface>
        </div>

        <IsoSurface className="iso-stack iso-rise iso-rise-3" aria-labelledby="paste-title">
          <h2 id="paste-title" className="iso-h2">
            Or paste the rows
          </h2>
          <Field label="Supplier rows" id="batch-csv">
            {({ id, describedBy }) => (
              <div className="iso-field__control">
                <textarea id={id} aria-describedby={describedBy} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="iso-batch__paste" placeholder={SAMPLE_BATCH_CSV.split('\n').slice(0, 3).join('\n')} />
              </div>
            )}
          </Field>
          {preview ? (
            <div className="iso-stack" aria-live="polite">
              <p className="iso-small" style={{ margin: 0 }}>
                {preview.rows.length} supplier{preview.rows.length === 1 ? '' : 's'} read
                {preview.rows.length ? `, ${php(preview.rows.reduce((a, r) => a + r.amountPhpMinor, 0n))} in total` : ''}.
              </p>
              {preview.errors.length ? (
                <div className="iso-note iso-note--amber iso-batch__fix">
                  <strong>Fix these rows first</strong>
                  <ul>
                    {preview.errors.map((e) => (
                      <li key={`${e.line}-${e.message}`}>{e.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          <div>
            <IsoButton variant="primary" busy={busy === 'quote'} disabled={busy !== null} disabledReason={blocker} onClick={() => void quote({ csv: text })}>
              {busy === 'quote' ? 'Quoting…' : 'Quote this batch'}
            </IsoButton>
          </div>
        </IsoSurface>

        {problem}

        <IsoSurface pad={false} className="iso-rise iso-rise-4" aria-labelledby="recent-batches">
          <div className="iso-surface--head">
            <h2 id="recent-batches" className="iso-h2">
              Recent batches
            </h2>
          </div>
          {recent === null ? (
            <div className="iso-surface--pad" aria-busy="true" aria-label="Loading recent batches">
              <span className="iso-skel" style={{ display: 'block', height: 48 }} />
            </div>
          ) : recent.length === 0 ? (
            <p className="iso-empty" style={{ margin: 0 }}>
              No batches yet.
            </p>
          ) : (
            <ul className="iso-list">
              {recent.map((b) => (
                <li key={b.id}>
                  <div className="iso-list__main">
                    <p className="iso-list__title" style={{ marginTop: 0 }}>
                      {b.payees} suppliers <span className="iso-num">{php(b.receivePhpMinor)}</span>
                    </p>
                    <p className="iso-list__detail" style={{ margin: 0 }}>
                      {dateShort(b.createdAt)} · {b.paid} of {b.payees} paid
                    </p>
                  </div>
                  <IsoButton variant="quiet" size="sm" href={`/dashboard/batch?batch=${b.id}`} aria-label={`Open the batch of ${b.payees} suppliers`}>
                    Open
                  </IsoButton>
                </li>
              ))}
            </ul>
          )}
        </IsoSurface>
      </>
    );
  }

  /* ------------------------------------------------------------ review and result */
  const sent = !['quoted', 'blocked', 'expired'].includes(batch.state);
  const paid = batch.rows.filter((r) => r.status === 'paid').length;
  const left = secondsLeft(batch.quoteExpiresAt, now);
  const chunks = batch.chunks.length;
  const approveWhy = !batch.allowed ? 'This batch doesn’t pass your rules.' : left <= 0 ? 'The quotes expired. Start the batch again for fresh quotes.' : null;

  return (
    <>
      <IsoSurface className="iso-stack iso-rise iso-rise-2" aria-labelledby="batch-sum">
        <div className="iso-batch__sumhead">
          <h2 id="batch-sum" className="iso-h2">
            {sent ? `${paid} of ${batch.totals.payees} suppliers paid` : `${batch.totals.payees} suppliers in ${chunks} chunk${chunks === 1 ? '' : 's'}`}
          </h2>
          <Tag tone="gold">{batch.simulated ? 'Test mode · simulated' : 'Test mode'}</Tag>
        </div>
        <dl className="iso-idrows">
          <div className="iso-idrow">
            <dt>Suppliers receive</dt>
            <dd>
              <span className="iso-idrow__value iso-num iso-batch__big">{php(batch.totals.receivePhpMinor)}</span>
            </dd>
          </div>
          <div className="iso-idrow">
            <dt>From your Payments account</dt>
            <dd>
              <span className="iso-idrow__value iso-num">
                <span className="iso-batch__big">{usd(batch.totals.youPayMinor)}</span> <span className="iso-small">including Splash&rsquo;s fee of {usd(batch.totals.feeMinor)}</span>
                <span className="iso-small iso-batch__exact">Exactly {usdExact(batch.totals.youPayMinor)}</span>
              </span>
            </dd>
          </div>
          <div className="iso-idrow">
            <dt>Paid by</dt>
            <dd>
              <span className="iso-idrow__value">{batch.partnerLabel}, one payout per supplier</span>
            </dd>
          </div>
          {!sent && batch.state === 'quoted' ? (
            <div className="iso-idrow">
              <dt>Quotes expire</dt>
              <dd>
                <span className="iso-idrow__value iso-num">{left > 0 ? `in ${clock(left)}` : 'now: start the batch again for fresh quotes'}</span>
              </dd>
            </div>
          ) : null}
        </dl>
      </IsoSurface>

      {!sent ? (
        <div className="iso-note iso-batch__how">
          <div>
            <strong>How it moves</strong>
            <p style={{ margin: '4px 0 0' }}>
              One transfer holds about {Math.max(...batch.chunks.map((c) => c.payees))} of these payments, so the batch goes in {chunks} chunk{chunks === 1 ? '' : 's'}. One approval on this device covers every chunk. Each chunk pays all its
              suppliers or none. If one chunk fails, the others still pay, and you retry only the one that failed.
            </p>
          </div>
        </div>
      ) : null}

      {!sent ? (
        <IsoSurface className="iso-stack" aria-labelledby="rules-title">
          <h2 id="rules-title" className="iso-h2">
            Rules
          </h2>
          <ul className="iso-batch__checks">
            {batch.checks.map((c) => (
              <li key={c.name} className={c.passed ? 'is-ok' : 'is-no'}>
                {c.passed ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : <X size={16} strokeWidth={3} aria-hidden="true" />}
                <span>
                  {c.label}
                  <span className="iso-sr">{c.passed ? ': passed' : ': not passed'}</span>
                </span>
              </li>
            ))}
          </ul>
        </IsoSurface>
      ) : null}

      <section className="iso-stack" aria-labelledby="chunks-title">
        <h2 id="chunks-title" className="iso-h2">
          Chunks
        </h2>
        <div className="iso-batch__chunks">
          {batch.chunks.map((c) => (
            <IsoSurface key={c.index} as="article" className="iso-stack iso-batch__chunk" aria-labelledby={`chunk-${c.index}`}>
              <div className="iso-batch__sumhead">
                <h3 id={`chunk-${c.index}`} className="iso-h3">
                  Chunk {c.index + 1}
                </h3>
                <Tag tone={sent ? chunkTone(c.state) : 'ink'} tick={sent && c.state === 'confirmed'}>
                  {sent ? c.stateLabel : 'Planned'}
                </Tag>
              </div>
              <p className="iso-num" style={{ margin: 0 }}>
                {c.payees} supplier{c.payees === 1 ? '' : 's'} · {usd(BigInt(c.payoutMinor) + BigInt(c.feeMinor))}
              </p>
              <p className="iso-small" style={{ margin: 0 }}>
                {/* How full the chunk's largest transfer is, as a share of what one transfer can hold. */}
                Fills {Math.floor((Math.max(c.sizes.execute, ...c.sizes.proposal) * 100) / BYTES)}% of one transfer
              </p>
              {c.calls.length ? (
                <ul className="iso-batch__calls">
                  {c.calls.map((k) => (
                    <li key={k.signature}>
                      {k.step === 'proposal' ? 'Approval' : 'Transfer'}
                      {k.status === 'expired' ? ' (expired, never landed)' : k.status === 'failed' ? ' (failed, nothing moved)' : ''}{' '}
                      {k.solscanUrl ? (
                        <a href={k.solscanUrl} target="_blank" rel="noreferrer">
                          <span className="iso-mono">{shortKey(k.signature, 5)}</span> · open its record
                        </a>
                      ) : (
                        <>
                          <span className="iso-mono" title={k.signature}>
                            {shortKey(k.signature, 5)}
                          </span>
                          {k.simulated ? ' (simulated)' : ''}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              {c.problem ? (
                <p className="iso-small" role="status" style={{ margin: 0 }}>
                  {c.problem.message}
                </p>
              ) : null}
              {c.retryable ? (
                <div>
                  <IsoButton variant="primary" busy={busy === `retry-${c.index}`} disabled={busy !== null} onClick={() => void approve(c.index)}>
                    {busy === `retry-${c.index}` ? 'Retrying…' : `Retry chunk ${c.index + 1}`}
                  </IsoButton>
                </div>
              ) : null}
            </IsoSurface>
          ))}
        </div>
      </section>

      {!sent && batch.state === 'quoted' ? (
        <IsoSurface className="iso-stack iso-batch__approve" aria-labelledby="approve-title">
          <h2 id="approve-title" className="iso-h2">
            Approve {chunks === 1 ? 'this batch' : `all ${chunks} chunks`}
          </h2>
          <p className="iso-small" style={{ margin: 0 }}>
            These rows are your file, checked by the rules above. A person approves, on this device.
          </p>
          {offline ? <Combobox label="Rehearse a problem (offline only)" options={REHEARSALS} value={rehearsal} onChange={(v) => setRehearsal(v === 'drop_chunk' ? 'drop_chunk' : 'none')} /> : null}
          <div className="iso-row">
            <IsoButton variant="primary" size="lg" busy={busy === 'approve'} disabled={busy !== null} disabledReason={approveWhy} onClick={() => void approve()}>
              {busy === 'approve' ? 'Sending chunk by chunk…' : `Approve ${chunks === 1 ? 'the batch' : `all ${chunks} chunks`} with this device`}
            </IsoButton>
            <IsoButton variant="link" href="/dashboard/batch">
              Start again
            </IsoButton>
          </div>
        </IsoSurface>
      ) : null}

      {batch.state === 'blocked' || batch.state === 'expired' ? (
        <div className="iso-note iso-note--amber">
          <div>
            <strong>{batch.state === 'expired' ? 'The quotes expired' : 'This batch does not pass your rules'}</strong>
            <p style={{ margin: '4px 0 0' }}>
              {batch.state === 'expired' ? 'Nothing was sent. ' : 'Nothing was sent. Add money to your Payments account or split the file, then quote it again. '}
              <Link href="/dashboard/batch">Start a new batch</Link>
            </p>
          </div>
        </div>
      ) : null}

      {problem}

      <IsoSurface pad={false} aria-labelledby="rows-title">
        <div className="iso-surface--head">
          <h2 id="rows-title" className="iso-h2">
            Suppliers
          </h2>
          <IsoButton variant="quiet" size="sm" onClick={() => downloadCsv(batch)}>
            Download CSV
          </IsoButton>
        </div>
        <table className="iso-table iso-table--stack iso-batch__rows">
          <caption className="iso-sr">Suppliers in this batch</caption>
          <thead>
            <tr>
              <th scope="col">Supplier</th>
              <th scope="col" className="iso-r">
                Receives
              </th>
              <th scope="col" className="iso-r">
                From your Payments account
              </th>
              <th scope="col">Chunk</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {batch.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.supplierName}</strong>
                  <span className="iso-batch__sub">
                    {r.bank} •••• {r.accountLast4}
                    {r.invoiceNumber ? ` · ${r.invoiceNumber}` : ''}
                  </span>
                </td>
                <td className="iso-r" data-label="Receives">
                  {php(r.amountPhpMinor)}
                </td>
                <td className="iso-r" data-label="From your Payments account" title={usdExact(r.youPayUsdcMinor)}>
                  {usd(r.youPayUsdcMinor)}
                </td>
                <td data-label="Chunk">{r.chunkIndex === null ? 'Not planned' : r.chunkIndex + 1}</td>
                <td>
                  <Tag tone={sent ? rowTone(r.status) : 'ink'} tick={sent && r.status === 'paid'}>
                    {sent ? r.statusLabel : 'Quoted'}
                  </Tag>
                  {r.bankReference ? <span className="iso-mono iso-batch__sub">{r.bankReference}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="iso-small iso-batch__foot">
          Amounts are rounded to the cent. Each transfer is exact to a millionth of a dollar, so the rows can add up to a cent more or less than the total above. The CSV has every amount exactly.
        </p>
      </IsoSurface>
    </>
  );
}
