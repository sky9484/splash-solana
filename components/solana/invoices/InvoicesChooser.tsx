// iso-ui
// iso-ui display-exception: chooser
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { canMorph, IsoDisplay, Morph, Tag, type TagTone } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import { INVOICE_LINKS } from '@/lib/dashboard/links';

import { api } from '../client';

export interface ChooserSummary {
  pay: { toCheck: number; ready: number; waiting: number };
  get: { unpaid: number; overdue: number };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const shown = (tags: Array<{ tone: TagTone; label: string } | null>) => tags.filter((t): t is { tone: TagTone; label: string } => t !== null);

/**
 * The navigation's view-transition type: styles/iso-ui.css fades the rest of the page (the card that
 * wasn't chosen with it) over the morph's own 420 ms, for these navigations only.
 */
export const INV_TYPES = ['iso-inv'];

/** How long the fallback holds the chosen card up before it navigates (prompt 11 Phase 3). */
const FALLBACK_MS = 320;

/**
 * Invoices (prompt 10 §6.1, frame Flow-Inv-Choose; prompt 11 Phase 3): only the choice. Two big cards,
 * each with its live counts from server state (GET /api/solana/invoices/summary), nothing when a count
 * is zero. The chosen card grows into the hero of the page it opens (a named view transition, 420 ms)
 * and the other fades out. Where view transitions can't run, the chosen card lifts to 1.03 for 320 ms
 * and then navigates. With reduced motion it is a plain navigation. Enter on a focused card is a
 * click, so the keyboard gets the same. The cards prefetch their whole page: the morph plays only
 * when the page renders in the same commit as the navigation, which needs its content cached (Next's
 * view-transitions guide); by default a dynamic page is prefetched only down to its loading boundary.
 * The coins are the cut-out copies (`*-cut.png`, prompt 12 B9): their faint edge pixels carry the
 * coin's own colours and their transparent pixels the card's cyan, so no light rim shows on the card.
 */
export function InvoicesChooser() {
  const router = useRouter();
  const [summary, setSummary] = useState<ChooserSummary | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    let stop = false;
    api<ChooserSummary>('/invoices/summary')
      .then((s) => !stop && setSummary(s))
      .catch(() => undefined);
    return () => {
      stop = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);
  function choose(e: MouseEvent<HTMLAnchorElement>, href: string) {
    // A new tab or window is the browser's own business; a morph runs inside the Link's navigation.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (canMorph() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    e.preventDefault();
    if (chosen) return;
    setChosen(href);
    timer.current = window.setTimeout(() => router.push(href), FALLBACK_MS);
  }
  return <InvoicesChooserView summary={summary} chosen={chosen} onChoose={choose} />;
}

export function InvoicesChooserView({ summary, chosen = null, onChoose }: { summary: ChooserSummary | null; chosen?: string | null; onChoose?: (e: MouseEvent<HTMLAnchorElement>, href: string) => void }) {
  const getHref = INVOICE_LINKS.get ?? '/dashboard/invoices/get';
  const payHref = INVOICE_LINKS.pay;
  const getTags = summary ? shown([summary.get.overdue > 0 ? { tone: 'amber', label: `${summary.get.overdue} overdue` } : null, summary.get.unpaid > 0 ? { tone: 'ink', label: plural(summary.get.unpaid, 'unpaid request', 'unpaid requests') } : null]) : [];
  const payTags = summary
    ? shown([
        summary.pay.toCheck > 0 ? { tone: 'amber', label: `${summary.pay.toCheck} to check` } : null,
        summary.pay.ready > 0 ? { tone: 'ink', label: `${summary.pay.ready} ready to pay` } : null,
        summary.pay.waiting > 0 ? { tone: 'coral', label: `${summary.pay.waiting} waiting for approval` } : null,
      ])
    : [];

  return (
    <div className="iso iso-page">
      <PageHead title="Invoices" context="Get paid by your customers, or pay what your suppliers send you." />
      <div className={`iso-chooser${chosen ? ' iso-chooser--leaving' : ''}`}>
        <Morph name="iso-inv-get">
          <Link className={`iso-chooser__card iso-chooser__card--first iso-rise${chosen === getHref ? ' is-chosen' : ''}`} href={getHref} prefetch transitionTypes={INV_TYPES} onClick={onChoose ? (e) => onChoose(e, getHref) : undefined}>
            <span className="iso-chooser__top">
              <IsoDisplay size="lg">Get paid</IsoDisplay>
              <Image className="iso-chooser__art iso-bob" src="/cinematic/token-usd-cut.png" alt="" width={96} height={96} />
            </span>
            <span className="iso-chooser__body">
              <span className="iso-chooser__lede">Send a request. A business on Splash pays in the app; anyone else pays by link.</span>
              {getTags.length > 0 ? (
                <span className="iso-chooser__tags">
                  {getTags.map((t) => (
                    <Tag key={t.label} tone={t.tone}>
                      {t.label}
                    </Tag>
                  ))}
                </span>
              ) : null}
              <span className="iso-btn iso-btn--primary iso-btn--lg iso-chooser__cta">Request a payment</span>
            </span>
          </Link>
        </Morph>
        <Morph name="iso-inv-pay">
          <Link className={`iso-chooser__card iso-chooser__card--second iso-rise${chosen === payHref ? ' is-chosen' : ''}`} href={payHref} prefetch transitionTypes={INV_TYPES} onClick={onChoose ? (e) => onChoose(e, payHref) : undefined}>
            <span className="iso-chooser__top">
              <IsoDisplay size="lg">Pay an invoice</IsoDisplay>
              <Image className="iso-chooser__art iso-bob iso-bob--late" src="/cinematic/token-php-cut.png" alt="" width={96} height={96} />
            </span>
            <span className="iso-chooser__body">
              <span className="iso-chooser__lede">Drop in a supplier&rsquo;s invoice. Zeke reads it; you check and approve.</span>
              {payTags.length > 0 ? (
                <span className="iso-chooser__tags">
                  {payTags.map((t) => (
                    <Tag key={t.label} tone={t.tone}>
                      {t.label}
                    </Tag>
                  ))}
                </span>
              ) : null}
              <span className="iso-btn iso-btn--primary iso-btn--lg iso-chooser__cta">Pay an invoice</span>
            </span>
          </Link>
        </Morph>
      </div>
    </div>
  );
}
