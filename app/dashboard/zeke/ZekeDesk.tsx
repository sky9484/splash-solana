// iso-ui
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Paperclip } from 'lucide-react';

import { IsoSurface, ScrollRegion, Tag } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import LocalTime from '@/components/LocalTime';
import { api, ApiError, php, usd } from '@/components/solana/client';
import { parseBatchFile, stashBatchDraft } from '@/lib/batch-parse';
import type { Wire } from '@/lib/solana-app/json';
import type { ZekeDesk as ZekeDeskData } from '@/lib/solana-app/zeke-desk';
import { useOxwalThread } from '@/lib/oxwal/use-oxwal-thread';

export type ZekeDeskDTO = Wire<ZekeDeskData>;

const CHANGED = 'splash-company-changed';

const WELCOME = 'Ask me about bills, payments, recipients or your treasury. I read, check and draft; a person approves every payment.';

const ROW: Record<ZekeDeskDTO['waiting'][number]['kind'], { tone: 'coral' | 'amber' | 'ink'; label: string }> = {
  approve: { tone: 'coral', label: 'Waiting approval' },
  verify: { tone: 'amber', label: 'Check bank details' },
  sweep: { tone: 'ink', label: 'Sweep draft' },
};

/**
 * The Zeke page (prompt 10 §7A, frame Flow-Zeke). The same agent as the floating Zeke
 * (useOxwalThread, one engine for every surface), with nothing on the page that approves: a draft is
 * a dashed ticket that opens where a person reads it in full and approves it on a device, and the
 * conversation runs with allowInlineApproval off. The counters, "Waiting for you" and "Today" come
 * from the server (GET /api/solana/zeke, lib/solana-app/zeke-desk.ts). The AI tag is its own element,
 * never driven by the assistant's name.
 */
export default function ZekeDesk() {
  const router = useRouter();
  const [desk, setDesk] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ZekeDeskDTO }>({ status: 'loading' });
  const [input, setInput] = useState('');
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { thread, streamingText, isSending, assistantName, threadRef, submitPrompt } = useOxwalThread({
    welcome: WELCOME,
    // No approving from the conversation: a draft opens where the whole payment can be read.
    allowInlineApproval: false,
  });

  const load = useCallback(async () => {
    try {
      setDesk({ status: 'ready', data: await api<{ desk: ZekeDeskDTO }>('/zeke').then((r) => r.desk) });
    } catch (e) {
      setDesk({ status: 'error', message: e instanceof ApiError ? e.message : 'Zeke’s desk did not load. Try again.' });
    }
  }, []);

  useEffect(() => {
    // Read after mount and whenever the company changes; the state is set when the read answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const onChange = () => void load();
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [load]);

  function send(text: string) {
    if (!text.trim()) return;
    void submitPrompt(text);
    setInput('');
  }

  async function attach(file: File) {
    setAttachNote(null);
    if (/\.(csv|xlsx)$/i.test(file.name)) {
      try {
        stashBatchDraft(await parseBatchFile(file));
        router.push('/dashboard/batch?draft=1');
      } catch {
        setAttachNote('That sheet couldn’t be read. Check it is a CSV or Excel file with one payout per row.');
      }
      return;
    }
    if (/\.(txt|text)$/i.test(file.name) || file.type.startsWith('text/')) {
      const text = (await file.text()).slice(0, 20_000);
      send(`Read this invoice and draft the payment:\n\n${text}`);
      return;
    }
    setAttachNote('Attach a payout sheet (CSV or Excel) or an invoice as text. PDFs and images are coming soon.');
  }

  const d = desk.status === 'ready' ? desk.data : null;
  const chips = d?.chips ?? ['What’s due this week?', 'Who changed bank details?', 'Summarise this month', 'What’s idle above my reserve?'];

  return (
    <div className="iso iso-page iso-desk">
      <PageHead
        title={
          <span className="iso-desk__title">
            <span className="iso-desk__face" aria-hidden="true">
              <Image className="iso-bob iso-bob--slow" src="/cinematic/agent-bot-cut.png" alt="" width={56} height={56} priority />
            </span>
            {assistantName} <Tag tone="ink">AI</Tag>
          </span>
        }
        context="Reads, checks and drafts. A person approves every payment."
        actions={
          <dl className="iso-desk__counts iso-num" aria-busy={desk.status === 'loading'}>
            <div className="iso-desk__count">
              <dt>Drafts today</dt>
              <dd>{d ? d.counters.draftsToday : '–'}</dd>
            </div>
            <div className="iso-desk__count iso-desk__count--coral">
              <dt>Need you</dt>
              <dd>{d ? d.counters.needYou : '–'}</dd>
            </div>
            <div className="iso-desk__count iso-desk__count--amber">
              <dt>Notices</dt>
              <dd>{d ? d.counters.notices : '–'}</dd>
            </div>
          </dl>
        }
      />

      {desk.status === 'error' ? (
        <p className="iso-note iso-note--danger" role="alert">
          {desk.message}{' '}
          <button type="button" className="iso-btn iso-btn--link" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}

      <div className="iso-split">
        {/* ── The desk: the conversation ── */}
        <IsoSurface hero pad={false} className="iso-split__main iso-rise iso-rise-2 iso-desk__chat" aria-labelledby="zk-desk">
          <h2 id="zk-desk" className="iso-h2 iso-desk__ask">
            What should we look at?
          </h2>
          <div ref={threadRef} className="iso-desk__thread" aria-live="polite">
            {thread.map((item) => {
              switch (item.kind) {
                case 'user':
                  return (
                    <p key={item.id} className="iso-zk__msg iso-zk__msg--you">
                      {item.text}
                    </p>
                  );
                case 'assistant':
                  return (
                    <div key={item.id} className="iso-zk__turn">
                      <span className="iso-zk__label">{assistantName}</span>
                      <p className="iso-zk__msg iso-zk__msg--zeke">{item.text}</p>
                    </div>
                  );
                case 'activity':
                  return (
                    <p key={item.id} className="iso-zk__activity">
                      {item.label}
                    </p>
                  );
                case 'notice':
                  return (
                    <p key={item.id} className="iso-note iso-note--amber">
                      {item.text}
                    </p>
                  );
                case 'session-expired':
                  return (
                    <p key={item.id} className="iso-note iso-note--amber">
                      Your session ended. <Link href="/login">Sign in again</Link> to keep asking.
                    </p>
                  );
                case 'proposal':
                  return <DraftTicket key={item.id} title={item.proposal.explain.recommendation} href="/queue" />;
                case 'handoff':
                  return <DraftTicket key={item.id} title={item.handoff.title} lines={item.handoff.lines} href={item.handoff.href} />;
                default:
                  return null;
              }
            })}
            {streamingText ? <p className="iso-zk__msg iso-zk__msg--zeke">{streamingText}</p> : null}
            {isSending && !streamingText ? <p className="iso-zk__activity">{assistantName} is reading…</p> : null}
          </div>
          <div className="iso-zk__chips iso-desk__chips" role="group" aria-label="Suggestions">
            {chips.map((c) => (
              <button key={c} type="button" className="iso-zk__chip" disabled={isSending} onClick={() => send(c)}>
                {c}
              </button>
            ))}
          </div>
          <form
            className="iso-zk__compose iso-desk__compose"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.txt,text/plain" hidden onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0])} />
            <button type="button" className="iso-zk__ico" aria-label="Attach an invoice or a payout sheet" onClick={() => fileRef.current?.click()}>
              <Paperclip size={18} aria-hidden="true" />
            </button>
            <label htmlFor="iso-desk-input" className="iso-sr">
              Ask {assistantName}
            </label>
            <input id="iso-desk-input" type="text" autoComplete="off" placeholder="Ask about bills, payments, recipients or your treasury" value={input} onChange={(e) => setInput(e.target.value)} disabled={isSending} />
            <button type="submit" className="iso-zk__ico iso-zk__send" aria-label="Send" disabled={isSending || !input.trim()}>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>
          {attachNote ? (
            <p className="iso-zk__foot" role="alert">
              {attachNote}
            </p>
          ) : null}
          <p className="iso-zk__foot iso-desk__foot">{assistantName} can&rsquo;t approve or move money, and it can be wrong. Check before you approve.</p>
        </IsoSurface>

        {/* ── The rail ── */}
        <div className="iso-split__side iso-stack iso-desk__rail">
          <IsoSurface pad className="iso-rise iso-rise-3 iso-stack" aria-labelledby="zk-wait">
            <h2 id="zk-wait" className="iso-h2">
              Waiting for you
            </h2>
            {!d ? (
              <div className="iso-skel" style={{ height: 120 }} aria-busy="true" aria-label="Loading" />
            ) : d.waiting.length === 0 ? (
              <p className="iso-small" style={{ margin: 0 }}>
                Nothing waits for you. Drafts Zeke makes show here until a person approves them.
              </p>
            ) : (
              <ul className="iso-desk__waits">
                {d.waiting.map((w) => (
                  <li key={`${w.kind}-${w.id}`}>
                    <Link href={w.href} className={`iso-desk__wait iso-desk__wait--${w.kind}`}>
                      <span>
                        <Tag tone={ROW[w.kind].tone}>{ROW[w.kind].label}</Tag>
                        <strong>{w.title}</strong>
                        <span className="iso-small">{w.detail}</span>
                      </span>
                      <span className="iso-num iso-desk__amount">{w.currency === 'PHP' ? php(w.amountMinor) : usd(w.amountMinor)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </IsoSurface>

          <IsoSurface pad className="iso-rise iso-rise-3" aria-labelledby="zk-log">
            <h2 id="zk-log" className="iso-h2">
              Today
            </h2>
            {!d ? (
              <div className="iso-skel" style={{ height: 120 }} aria-busy="true" aria-label="Loading" />
            ) : d.today.length === 0 ? (
              <p className="iso-small" style={{ margin: '8px 0 0' }}>
                Nothing yet today. What Zeke reads, flags and drafts shows here, with the time.
              </p>
            ) : (
              <ol className="iso-desk__log">
                {d.today.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <span className="iso-num iso-small">
                      <LocalTime value={e.at} format="time" options={{ hour: '2-digit', minute: '2-digit', hour12: false }} />
                    </span>
                    <span>
                      <strong>{e.what}</strong>
                      <span className="iso-small">{e.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </IsoSurface>

          <section className="iso-surface iso-surface--pad iso-surface--ink iso-rise iso-rise-4 iso-desk__safe" aria-labelledby="zk-safe">
            <h2 id="zk-safe" className="iso-h3">
              How Zeke is kept safe
            </h2>
            <ul>
              {(d?.safety ?? []).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {/* ── What each part of Zeke does ── */}
      <IsoSurface className="iso-rise iso-rise-4" aria-labelledby="zk-team">
        <div className="iso-surface--head">
          <h2 id="zk-team" className="iso-h2">
            What each part of Zeke does
          </h2>
        </div>
        {d ? (
          <ScrollRegion label="What each part of Zeke does">
            <table className="iso-table iso-table--stack">
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  <th scope="col">Does</th>
                  <th scope="col">Never</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.roster.map((r) => (
                  <tr key={r.part}>
                    <td data-label="Part">
                      <strong>{r.part}</strong>
                    </td>
                    <td data-label="Does">{r.does}</td>
                    <td data-label="Never" className="iso-small">
                      {r.never}
                    </td>
                    <td data-label="Status">
                      {r.status === 'Built' ? (
                        <Tag tone="ok" tick>
                          Built
                        </Tag>
                      ) : (
                        <Tag tone="ink">Planned</Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ) : (
          <div className="iso-skel" style={{ height: 200, margin: 22 }} aria-busy="true" aria-label="Loading" />
        )}
      </IsoSurface>
    </div>
  );
}

/**
 * Where a ticket may open: a page inside the dashboard (or the approval queue), nothing else. Its link
 * arrives on the agent's stream, so it is checked here rather than trusted.
 */
export function safeTicketHref(href: string): string {
  return /^\/(dashboard|queue)(\/|\?|$)/.test(href) ? href : '/dashboard';
}

/** A draft Zeke prepared: a dashed ticket that opens where a person reads it in full and approves it. */
function DraftTicket({ title, lines = [], href }: { title: string; lines?: string[]; href: string }) {
  return (
    <div className="iso-zk__draft iso-desk__draft">
      <Tag tone="ink">Draft · not approved</Tag>
      <strong>{title}</strong>
      {lines.slice(0, 3).map((l) => (
        <span key={l} className="iso-small">
          {l}
        </span>
      ))}
      <Link href={safeTicketHref(href)} className="iso-zk__open">
        Open to review
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
      <span className="iso-small">You approve in Transfer, on your device. Zeke can&rsquo;t.</span>
    </div>
  );
}
