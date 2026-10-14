// iso-ui
// iso-ui display-exception: chooser
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { IsoDisplay, Morph, Tag, type TagTone } from '@/components/iso';
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
 * Invoices (prompt 10 §6.1, frame Flow-Inv-Choose): only the choice. Two big cards, each with its live
 * counts from server state (GET /api/solana/invoices/summary), nothing when a count is zero. The chosen
 * card grows into the page it opens (a named view transition); with reduced motion it is a plain
 * navigation.
 */
export function InvoicesChooser() {
  const [summary, setSummary] = useState<ChooserSummary | null>(null);
  useEffect(() => {
    let stop = false;
    api<ChooserSummary>('/invoices/summary')
      .then((s) => !stop && setSummary(s))
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);
  return <InvoicesChooserView summary={summary} />;
}

export function InvoicesChooserView({ summary }: { summary: ChooserSummary | null }) {
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
      <div className="iso-chooser">
        <Morph name="iso-inv-get">
          <Link className="iso-chooser__card iso-rise iso-rise-2" href={INVOICE_LINKS.get ?? '/dashboard/invoices/get'}>
            <span className="iso-chooser__top">
              <IsoDisplay size="lg">Get paid</IsoDisplay>
              <Image className="iso-chooser__art iso-bob" src="/cinematic/token-usd.png" alt="" width={96} height={96} />
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
          <Link className="iso-chooser__card iso-rise iso-rise-3" href={INVOICE_LINKS.pay}>
            <span className="iso-chooser__top">
              <IsoDisplay size="lg">Pay an invoice</IsoDisplay>
              <Image className="iso-chooser__art iso-bob iso-bob--late" src="/cinematic/token-php.png" alt="" width={96} height={96} />
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
