'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

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

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'pending' | 'sim'; children: React.ReactNode }) {
  return <span className={`sx-pill sx-pill-${tone}`}>{children}</span>;
}

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

const rowTone = (s: string) => (s === 'paid' ? 'ok' : s === 'returned' || s === 'not_sent' ? 'warn' : 'pending');
const chunkTone = (s: string) => (s === 'confirmed' ? 'ok' : s === 'failed' || s === 'not_sent' ? 'warn' : 'pending');

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
  const [recent, setRecent] = useState<BatchSummaryDTO[]>([]);
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

  if (state.status === 'loading') return <p className="sx-muted">Loading your company…</p>;
  if (state.status !== 'ready' || !state.company.vault) {
    return (
      <div className="sx-narrow sx-stack">
        <p className="sx-lede">{state.status === 'ready' ? 'Set up this device and your accounts first.' : state.message}</p>
        <Link className="sx-btn" href={state.status === 'signin' ? '/login' : '/dashboard/setup'}>
          {state.status === 'signin' ? 'Sign in' : 'Set up this device'}
        </Link>
      </div>
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

  /* ------------------------------------------------------------ start */
  if (!batch) {
    return (
      <div className="sx-stack-lg">
        <div className="sx-routes" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <section className="sx-card sx-stack">
            <h2>Upload a supplier file</h2>
            <p className="sx-muted sx-small">CSV with columns supplier, bank, account, amount (pesos), invoice. Only the last four account digits are kept.</p>
            <label className="sx-btn sx-btn-ghost" style={{ display: 'inline-flex', cursor: 'pointer' }}>
              Choose a CSV file
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sx-visually-hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setText(await f.text());
                }}
              />
            </label>
          </section>
          <section className="sx-card sx-stack">
            <h2>Use the sample batch</h2>
            <p className="sx-muted sx-small">Twelve fictional suppliers in the Philippines, from ₱5,200 to ₱64,300.</p>
            <div>
              <button type="button" className="sx-btn" disabled={busy !== null} onClick={() => void quote({ sample: true })}>
                {busy === 'quote' ? 'Quoting…' : 'Quote the sample batch'}
              </button>
            </div>
          </section>
        </div>

        <section className="sx-card sx-stack" aria-labelledby="paste-title">
          <h2 id="paste-title">Or paste the rows</h2>
          <label htmlFor="batch-csv" className="sx-visually-hidden">
            Supplier rows
          </label>
          <textarea id="batch-csv" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 140 }} placeholder={SAMPLE_BATCH_CSV.split('\n').slice(0, 3).join('\n')} />
          {preview ? (
            <div className="sx-stack" aria-live="polite">
              <p className="sx-small">
                {preview.rows.length} supplier{preview.rows.length === 1 ? '' : 's'} read
                {preview.rows.length ? `, ${php(preview.rows.reduce((a, r) => a + r.amountPhpMinor, 0n))} in total` : ''}.
              </p>
              {preview.errors.length ? (
                <div className="sx-notice sx-notice-warn">
                  <h3>Fix these rows first</h3>
                  <ul className="sx-mock-list">
                    {preview.errors.map((e) => (
                      <li key={`${e.line}-${e.message}`}>{e.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          <div>
            <button type="button" className="sx-btn" disabled={busy !== null || !preview || preview.rows.length === 0 || preview.errors.length > 0} onClick={() => void quote({ csv: text })}>
              {busy === 'quote' ? 'Quoting…' : 'Quote this batch'}
            </button>
          </div>
        </section>

        {error ? (
          <div className="sx-notice sx-notice-error" role="alert">
            <p>{error.message}</p>
          </div>
        ) : null}

        <section className="sx-stack" aria-labelledby="recent-batches">
          <h2 id="recent-batches">Recent batches</h2>
          {recent.length === 0 ? (
            <p className="sx-muted">No batches yet.</p>
          ) : (
            <ul className="sx-verify">
              {recent.map((b) => (
                <li key={b.id} className="sx-pay-row">
                  <span>
                    <strong>{b.payees} suppliers</strong> <span className="sx-num">{php(b.receivePhpMinor)}</span>
                    <span className="sx-small sx-muted" style={{ display: 'block' }}>
                      {dateShort(b.createdAt)} · {b.paid} of {b.payees} paid
                    </span>
                  </span>
                  <Link href={`/dashboard/batch?batch=${b.id}`}>
                    Open<span className="sx-visually-hidden"> the batch of {b.payees} suppliers</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  /* ------------------------------------------------------------ review and result */
  const sent = !['quoted', 'blocked', 'expired'].includes(batch.state);
  const paid = batch.rows.filter((r) => r.status === 'paid').length;
  const left = secondsLeft(batch.quoteExpiresAt, now);
  const chunks = batch.chunks.length;

  return (
    <div className="sx-stack-lg">
      <section className="sx-card sx-stack" aria-labelledby="batch-sum">
        <div className="sx-row" style={{ justifyContent: 'space-between' }}>
          <h2 id="batch-sum">
            {sent ? `${paid} of ${batch.totals.payees} suppliers paid` : `${batch.totals.payees} suppliers in ${chunks} chunk${chunks === 1 ? '' : 's'}`}
          </h2>
          {batch.simulated ? <Pill tone="sim">Test mode · simulated</Pill> : <Pill tone="pending">Test mode</Pill>}
        </div>
        <dl className="sx-kv">
          <dt>Suppliers receive</dt>
          <dd className="sx-num">{php(batch.totals.receivePhpMinor)}</dd>
          <dt>From your Payments account</dt>
          <dd className="sx-num">
            {usd(batch.totals.youPayMinor)} <span className="sx-muted sx-small">including Splash&rsquo;s fee of {usd(batch.totals.feeMinor)}</span>
            <span className="sx-muted sx-small" style={{ display: 'block' }}>
              Exactly {usdExact(batch.totals.youPayMinor)}
            </span>
          </dd>
          <dt>Paid by</dt>
          <dd>{batch.partnerLabel}, one payout per supplier</dd>
          {!sent && batch.state === 'quoted' ? (
            <>
              <dt>Quotes expire</dt>
              <dd>{left > 0 ? `in ${clock(left)}` : 'now: start the batch again for fresh quotes'}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {!sent ? (
        <div className="sx-notice sx-notice-info">
          <h3>How it moves</h3>
          <p>
            One transfer holds about {Math.max(...batch.chunks.map((c) => c.payees))} of these payments, so the batch goes in {chunks} chunk{chunks === 1 ? '' : 's'}. One approval on this device covers every chunk. Each chunk pays all its
            suppliers or none. If one chunk fails, the others still pay, and you retry only the one that failed.
          </p>
        </div>
      ) : null}

      {!sent ? (
        <section className="sx-card sx-stack" aria-labelledby="rules-title">
          <h2 id="rules-title">Rules</h2>
          <ul className="sx-checks">
            {batch.checks.map((c) => (
              <li key={c.name}>
                <span aria-hidden="true" className={c.passed ? 'ok' : 'no'}>
                  {c.passed ? '✓' : '✕'}
                </span>
                <span>
                  {c.label}
                  <span className="sx-visually-hidden">{c.passed ? ': passed' : ': not passed'}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="sx-stack" aria-labelledby="chunks-title">
        <h2 id="chunks-title">Chunks</h2>
        <div className="sx-routes" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {batch.chunks.map((c) => (
            <article key={c.index} className="sx-card sx-stack" aria-labelledby={`chunk-${c.index}`}>
              <div className="sx-row" style={{ justifyContent: 'space-between' }}>
                <h3 id={`chunk-${c.index}`}>Chunk {c.index + 1}</h3>
                <Pill tone={sent ? chunkTone(c.state) : 'pending'}>{sent ? c.stateLabel : 'Planned'}</Pill>
              </div>
              <p className="sx-small">
                {c.payees} supplier{c.payees === 1 ? '' : 's'} · {usd(BigInt(c.payoutMinor) + BigInt(c.feeMinor))}
              </p>
              <p className="sx-small sx-muted">
                Largest transaction {Math.max(c.sizes.execute, ...c.sizes.proposal).toLocaleString('en-US')} of {BYTES.toLocaleString('en-US')} bytes
              </p>
              {c.calls.length ? (
                <ul className="sx-mock-list sx-small">
                  {c.calls.map((k) => (
                    <li key={k.signature}>
                      {k.step === 'proposal' ? 'Proposal' : 'Transfer'}
                      {k.status === 'expired' ? ' (expired, never landed)' : k.status === 'failed' ? ' (failed, nothing moved)' : ''}{' '}
                      {k.solscanUrl ? (
                        <a href={k.solscanUrl} target="_blank" rel="noreferrer">
                          <span className="sx-mono">{shortKey(k.signature, 5)}</span> · open its record
                        </a>
                      ) : (
                        <span className="sx-mono" title={k.signature}>
                          {shortKey(k.signature, 5)} {k.simulated ? '(simulated)' : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              {c.problem ? <p className="sx-small" role="status">{c.problem.message}</p> : null}
              {c.retryable ? (
                <div>
                  <button type="button" className="sx-btn" disabled={busy !== null} onClick={() => void approve(c.index)}>
                    {busy === `retry-${c.index}` ? 'Retrying…' : `Retry chunk ${c.index + 1}`}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {!sent && batch.state === 'quoted' ? (
        <section className="sx-card sx-approve sx-stack" aria-labelledby="approve-title">
          <h2 id="approve-title">Approve {chunks === 1 ? 'this batch' : `all ${chunks} chunks`}</h2>
          <p className="sx-small sx-muted">These rows are your file, checked by the rules above. A person approves, on this device.</p>
          {offline ? (
            <label className="sx-small">
              Rehearse a problem (offline only){' '}
              <select value={rehearsal} onChange={(e) => setRehearsal(e.target.value as 'none' | 'drop_chunk')}>
                <option value="none">No problem: the normal path</option>
                <option value="drop_chunk">One chunk&rsquo;s transfer does not land</option>
              </select>
            </label>
          ) : null}
          <div className="sx-row">
            <button type="button" className="sx-btn" disabled={busy !== null || !batch.allowed || left <= 0} onClick={() => void approve()}>
              {busy === 'approve' ? 'Sending chunk by chunk…' : `Approve ${chunks === 1 ? 'the batch' : `all ${chunks} chunks`} with this device`}
            </button>
            <Link className="sx-btn-link" href="/dashboard/batch">
              Start again
            </Link>
          </div>
        </section>
      ) : null}

      {batch.state === 'blocked' || batch.state === 'expired' ? (
        <div className="sx-notice sx-notice-warn">
          <h3>{batch.state === 'expired' ? 'The quotes expired' : 'This batch does not pass your rules'}</h3>
          <p>
            {batch.state === 'expired' ? 'Nothing was sent. ' : 'Nothing was sent. Add money to your Payments account or split the file, then quote it again. '}
            <Link href="/dashboard/batch">Start a new batch</Link>
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="sx-notice sx-notice-error" role="alert">
          <p>{error.message}</p>
        </div>
      ) : null}

      <section className="sx-card sx-table-wrap bg-white" aria-labelledby="rows-title">
        <h2 id="rows-title" className="sx-visually-hidden">
          Suppliers
        </h2>
        <table className="sx-table">
          <caption className="sx-visually-hidden">Suppliers in this batch</caption>
          <thead>
            <tr>
              <th scope="col">Supplier</th>
              <th scope="col" className="sx-num-col">
                Receives
              </th>
              <th scope="col" className="sx-num-col">
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
                  <span className="sx-small sx-muted" style={{ display: 'block' }}>
                    {r.bank} •••• {r.accountLast4}
                    {r.invoiceNumber ? ` · ${r.invoiceNumber}` : ''}
                  </span>
                </td>
                <td className="sx-num-col" data-label="Receives">
                  {php(r.amountPhpMinor)}
                </td>
                <td className="sx-num-col" data-label="From your Payments account" title={usdExact(r.youPayUsdcMinor)}>
                  {usd(r.youPayUsdcMinor)}
                </td>
                <td data-label="Chunk">{r.chunkIndex === null ? 'Not planned' : r.chunkIndex + 1}</td>
                <td>
                  <Pill tone={sent ? rowTone(r.status) : 'pending'}>{sent ? r.statusLabel : 'Quoted'}</Pill>
                  {r.bankReference ? (
                    <span className="sx-mono sx-small" style={{ display: 'block', marginTop: 4 }}>
                      {r.bankReference}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sx-row" style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <p className="sx-small sx-muted" style={{ maxWidth: '62ch' }}>
            Amounts are rounded to the cent. Each transfer is exact to a millionth of a dollar, so the rows can add up to a cent more or
            less than the total above. The CSV has every amount exactly.
          </p>
          <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => downloadCsv(batch)}>
            Download CSV
          </button>
        </div>
      </section>
    </div>
  );
}
