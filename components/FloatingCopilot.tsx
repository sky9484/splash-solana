// iso-ui
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowRight, Maximize2, Paperclip, X } from 'lucide-react';
import clsx from 'clsx';

import { useOverlayOpen } from '@/components/iso';
import { parseBatchFile, stashBatchDraft } from '@/lib/batch-parse';
import { useOxwalThread } from '@/lib/oxwal/use-oxwal-thread';
import { floatingZekeHiddenOn, zekeContextFor, zekeNudge } from '@/lib/solana-zeke/context';

/**
 * Zeke, floating on every dashboard page (prompt 10 §3.5, frame "Floating Zeke · states").
 *
 * ─── One assistant, not a smaller different one ─────────────────────────────
 * It runs the same agent as the Zeke page (useOxwalThread), so the same question gets the same
 * answer on every surface. It knows which page it is open on ("Looking at: Transfer · Step 3,
 * quote") and sends that page's name with each question: a name from a fixed list, never an
 * account number or anything a person typed.
 *
 * ─── What it deliberately will not do ───────────────────────────────────────
 * It will not approve a payment (allowInlineApproval: false, and no approve control here): a draft
 * shows as a dashed ticket that opens the approval moment, where the whole payment can be read. It
 * doesn't make small talk: the one nudge beside the launcher says that a draft waits, and only then.
 * It steps aside on the Zeke page, while a sheet is open and during the approval moment, and on
 * Transfer it sits above the action bar.
 *
 * An attached payout sheet goes to Batch payout through sessionStorage, never the URL: recipient
 * details stay in the tab.
 */

const OPENING = 'Ask me about this page, what’s due, or a payment. I read and draft; a person approves.';

export default function FloatingCopilot({ waiting }: { waiting: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const overlay = useOverlayOpen();
  const ctx = zekeContextFor(pathname, search?.toString() ?? '');
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const launcher = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const { thread, streamingText, isSending, assistantName, threadRef, submitPrompt } = useOxwalThread({
    welcome: OPENING,
    // Quick questions: a short history keeps each turn quick.
    historyTurns: 6,
    // No approving from a floating panel: see above.
    allowInlineApproval: false,
    page: ctx.label,
  });

  const hidden = floatingZekeHiddenOn(pathname) || overlay;
  const nudge = zekeNudge(waiting);
  const onTransfer = pathname.startsWith('/dashboard/transfer');

  // Open: focus goes to the question. Esc closes and gives focus back to the launcher.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      setTimeout(() => launcher.current?.focus(), 0);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (hidden) return null;

  function send(text: string) {
    if (!text.trim()) return;
    void submitPrompt(text);
    setInput('');
  }

  async function attach(file: File) {
    setAttachNote(null);
    if (/\.(csv|xlsx)$/i.test(file.name)) {
      try {
        const batch = await parseBatchFile(file);
        stashBatchDraft(batch);
        setOpen(false);
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

  function startDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button, a')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const maxX = Math.max(0, window.innerWidth - 120);
    const maxY = Math.max(0, window.innerHeight - 160);
    setOffset({ x: Math.max(-maxX, Math.min(0, d.ox + e.clientX - d.x)), y: Math.max(-maxY, Math.min(0, d.oy + e.clientY - d.y)) });
  }
  function stopDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }

  return (
    <div className={clsx('iso iso-zk', onTransfer && 'iso-zk--raised')}>
      {open ? (
        <section className="iso-zk__panel" role="dialog" aria-label={`${assistantName}, an AI assistant`} style={{ translate: `${offset.x}px ${offset.y}px` }}>
          <span className="iso-zk__grab" aria-hidden="true" />
          <div className="iso-zk__head" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
            <span className="iso-zk__face" aria-hidden="true">
              <Image src="/cinematic/agent-bot-cut.png" alt="" width={64} height={64} />
            </span>
            <span className="iso-zk__who">
              <span className="iso-zk__name">
                {/* The AI tag is its own element, never driven by the assistant's name: renaming
                    the assistant cannot hide that this is an AI. */}
                <strong>{assistantName}</strong>
                <span className="iso-zk__ai">AI</span>
              </span>
              <span className="iso-zk__role">Reads and drafts. A person approves.</span>
            </span>
            <Link className="iso-zk__x" href="/dashboard/zeke" aria-label="Open the full Zeke page" onClick={() => setOpen(false)}>
              <Maximize2 size={16} aria-hidden="true" />
            </Link>
            <button
              type="button"
              className="iso-zk__x"
              aria-label={`Close ${assistantName}`}
              onClick={() => {
                setOpen(false);
                setTimeout(() => launcher.current?.focus(), 0);
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="iso-zk__ctx">
            <span className="iso-zk__ctxdot" aria-hidden="true" />
            <span>
              Looking at: <strong>{ctx.label}</strong>
            </span>
          </p>

          <div ref={threadRef} className="iso-zk__thread" aria-live="polite">
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
                  return <DraftTicket key={item.id} title={item.proposal.explain.recommendation} href="/queue" onOpen={() => setOpen(false)} />;
                case 'handoff':
                  return <DraftTicket key={item.id} title={item.handoff.title} lines={item.handoff.lines} href={item.handoff.href} onOpen={() => setOpen(false)} />;
                default:
                  return null;
              }
            })}
            {streamingText ? <p className="iso-zk__msg iso-zk__msg--zeke">{streamingText}</p> : null}
            {isSending && !streamingText ? <p className="iso-zk__activity">{assistantName} is reading…</p> : null}
          </div>

          <div className="iso-zk__chips" role="group" aria-label="Suggestions">
            {ctx.chips.map((c) => (
              <button key={c} type="button" className="iso-zk__chip" disabled={isSending} onClick={() => send(c)}>
                {c}
              </button>
            ))}
          </div>

          <form
            className="iso-zk__compose"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.txt,text/plain" hidden onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0])} />
            <button type="button" className="iso-zk__ico" aria-label="Attach an invoice or a payout sheet" onClick={() => fileRef.current?.click()}>
              <Paperclip size={18} aria-hidden="true" />
            </button>
            <label htmlFor="iso-zk-input" className="iso-sr">
              Ask {assistantName}
            </label>
            <input id="iso-zk-input" ref={inputRef} type="text" autoComplete="off" placeholder={`Ask ${assistantName}, or attach an invoice`} value={input} onChange={(e) => setInput(e.target.value)} disabled={isSending} />
            <button type="submit" className="iso-zk__ico iso-zk__send" aria-label="Send" disabled={isSending || !input.trim()}>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>
          {attachNote ? (
            <p className="iso-zk__foot" role="alert">
              {attachNote}
            </p>
          ) : null}
          <p className="iso-zk__foot">Zeke can&rsquo;t approve or move money, and it can be wrong. Check before you approve.</p>
        </section>
      ) : (
        <button
          ref={launcher}
          type="button"
          className="iso-zk__launch"
          aria-label={nudge ? `Open ${assistantName}. ${nudge}` : `Open ${assistantName}`}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          {nudge ? <span className="iso-zk__nudge">{nudge}</span> : null}
          <span className="iso-zk__tile">
            <Image src="/cinematic/agent-bot-cut.png" alt="" width={92} height={92} priority />
            {waiting > 0 ? (
              <span className="iso-zk__count" aria-hidden="true">
                {waiting > 9 ? '9+' : waiting}
              </span>
            ) : null}
          </span>
        </button>
      )}
    </div>
  );
}

/** A draft Zeke prepared: a dashed ticket that opens where a person reads and approves it. */
function DraftTicket({ title, lines = [], href, onOpen }: { title: string; lines?: string[]; href: string; onOpen: () => void }) {
  return (
    <div className="iso-zk__draft">
      <span className="iso-tag iso-tag--ink">Draft · not approved</span>
      <strong>{title}</strong>
      {lines.slice(0, 3).map((l) => (
        <span key={l} className="iso-small">
          {l}
        </span>
      ))}
      {/* The link arrives on the agent's stream: only a page inside the dashboard (or the queue) opens. */}
      <Link href={/^\/(dashboard|queue)(\/|\?|$)/.test(href) ? href : '/dashboard'} className="iso-zk__open" onClick={onOpen}>
        Open to approve
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}
