import type { Metadata } from 'next';
import { BRAND } from '@/content/brand';
import Image from 'next/image';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { ArrowRight } from 'lucide-react';

import ReceivableCard from '@/components/supply/ReceivableCard';

export const metadata: Metadata = {
  title: 'Dynamic discounting for Southeast Asia — early invoice payment on Splash (roadmap)',
  description:
    'Splash is building buyer-funded dynamic discounting for the Philippines and Southeast Asia: early payment on verified invoices over the same Solana settlement rail that moves payouts today. Coming capability, subject to licensing.',
  keywords: [
    'dynamic discounting Philippines',
    'early payment program Southeast Asia',
    'invoice early payment',
    'buyer-funded discounting',
    'working capital Southeast Asia',
  ],
};

/* Prompt 12 Phase 4 (preview tab 3). Clean type only (decision 8): Geist 800 in sentence case, the
   accent words in teal. The boxes, tags and buttons are the landing's (styles/landing-p12.css); this
   page's own layout is styles/wc-p12.css. The footer is untouched. */

const heroFacts = [
  { k: 'Funded by', v: 'The buyer, not a lender' },
  { k: 'Rail', v: 'Same one payouts use' },
  { k: 'Control', v: 'Approval-gated, human-final' },
];

type Box = readonly [number, number, number, number];
type Card = { label: string; title: string; copy: string; image: string; box: Box; foot: string };

/**
 * These six pictures keep a wide transparent margin (their art is 56 to 79% of the 1200 × 900 frame),
 * where the preview used trimmed copies. `box` is each picture's art, measured from its alpha channel
 * (x0, y0, x1, y1), and `fill` centres that art and zooms it to fill the 170 px art box, up to 160 px
 * tall and 250 px wide, so a three-column card never clips it (styles/wc-p12.css, .wk-art).
 */
function fill([x0, y0, x1, y1]: Box): CSSProperties {
  const zoom = (900 / 170) * Math.min(160 / (y1 - y0), 250 / (x1 - x0));
  return {
    '--wk-zoom': zoom.toFixed(3),
    '--wk-dx': `${((600 - (x0 + x1) / 2) / 12).toFixed(2)}%`,
    '--wk-dy': `${((450 - (y0 + y1) / 2) / 9).toFixed(2)}%`,
  } as CSSProperties;
}

const receivable: Card[] = [
  {
    label: 'Verified',
    title: 'Issued between verified businesses.',
    copy: 'A Receivable would only exist between two KYB-verified counterparties already transacting on Splash: the same verification that gates every payout today.',
    image: '/isometric/wc-receivable-1.png',
    box: [144, 160, 1065, 672],
    foot: 'KYB-gated on both sides',
  },
  {
    label: 'History',
    title: 'Carries its settlement history.',
    copy: 'Quotes, approvals, receipts and settlement proof would anchor to the invoice itself: an invoice that shows how reliably it gets paid.',
    image: '/isometric/wc-receivable-2.png',
    box: [368, 63, 872, 776],
    foot: 'Record attached',
  },
  {
    label: 'Fundable',
    title: 'Safe to pay early.',
    copy: 'A receivable with a clean, verifiable history is the safest thing to fund early. No guesswork, no external credit file: the record is the underwriting.',
    image: '/isometric/wc-receivable-3.png',
    box: [168, 50, 1040, 751],
    foot: 'History a buyer can read',
  },
];

const discounting: Card[] = [
  {
    label: 'Offer',
    title: 'Buyer offers early payment.',
    copy: 'Your buyer sees an approved 90-day invoice and offers to pay it now, with their own US dollars already on the settlement rail.',
    image: '/isometric/wc-discount-1.png',
    box: [159, 156, 1022, 691],
    foot: 'Buyer-initiated',
  },
  {
    label: 'Accept',
    title: 'Supplier accepts a discount.',
    copy: 'You choose per invoice: the full amount on the due date, or a small discount today. No obligation either way.',
    image: '/isometric/wc-discount-2.png',
    box: [209, 124, 1003, 712],
    foot: 'Per-invoice choice',
  },
  {
    label: 'Settle',
    title: 'Settlement, no lender.',
    copy: 'The buyer’s own funds would settle the early payment over Splash. No factoring house, no credit line, no lender between you.',
    image: '/isometric/wc-discount-3.png',
    box: [51, 121, 1136, 709],
    foot: 'No third-party lender',
  },
];

type Foot = string | { from: string; to: string };

/** Where Supply fits: three text cards, no pictures (D4: they would repeat the landing's loops). */
const loops: { name: string; role: string; live: boolean; copy: string; foot: Foot[] }[] = [
  {
    name: 'Settle',
    role: 'The feeding wedge',
    live: true,
    copy: 'Collect USD, pay Southeast Asia. Every approved payout builds verified counterparties and settlement history.',
    foot: [{ from: 'USD', to: 'PHP' }, 'Live on testnet'],
  },
  {
    name: 'Supply',
    role: 'Working capital',
    live: false,
    copy: 'Invoices would become working capital: your buyer funds early payment against a receivable whose settlement history both sides can verify.',
    foot: ['Buyer-funded', 'No third-party lender'],
  },
  {
    name: 'Save',
    role: 'Balance hygiene',
    live: true,
    copy: 'Idle US dollars wait in your own account. Your business approves every move.',
    foot: ['Human-approved'],
  },
];

function Head({ number, label, title, accent, lede }: { number: string; label: string; title: string; accent: string; lede: string }) {
  return (
    <div className="lp-head">
      <div>
        <p className="lp-kick">
          <span className="lp-num">{number}</span>
          {label}
        </p>
        <h2 className="lp-h-clean">
          {title} <em>{accent}</em>
        </h2>
      </div>
      <p className="lp-lede">{lede}</p>
    </div>
  );
}

function Cards({ items }: { items: Card[] }) {
  return (
    <div className="lp-grid3">
      {items.map((item) => (
        <article className="lp-card lp-card--hover" key={item.label}>
          <p className="lp-kick">{item.label}</p>
          <div className="lp-card__art wk-art">
            <Image src={item.image} alt="" width={1200} height={900} sizes="(max-width: 1000px) 90vw, 400px" style={fill(item.box)} />
          </div>
          <h3 className="lp-card__title">{item.title}</h3>
          <p className="lp-card__copy">{item.copy}</p>
          <span className="lp-tag">{item.foot}</span>
        </article>
      ))}
    </div>
  );
}

export default function WorkingCapitalPage() {
  return (
    <main className="wc-page wk sp-page sp-ground-paper">
      <header className="lp-wrap wk-top">
        <Link href="/" className="wk-brand" aria-label="Splash Finance home">
          <Image src="/splash-main-icon.png" alt="" width={841} height={823} sizes="30px" preload />
          <span>Splash</span>
        </Link>
        <nav className="wk-top__nav" aria-label="Page navigation">
          <Link href="/" className="lp-btn lp-btn--quiet">Back to Splash</Link>
          <Link href="/signup" className="lp-btn lp-btn--dark">Start sending</Link>
        </nav>
      </header>

      <section className="lp-sec wk-hero-sec" aria-labelledby="wk-title">
        <div className="lp-wrap">
          <div className="lp-band wk-hero">
            <div>
              <div className="wk-hero__labels">
                <p className="lp-kick">Supply loop, roadmap</p>
                <span className="lp-tag lp-tag--coral">Coming capability, subject to licensing</span>
              </div>
              <h1 className="wk-h1" id="wk-title">
                Your invoices are <em>working capital.</em>
              </h1>
              <p className="lp-lede">
                Splash is building buyer-funded early payment on the same settlement rail that moves your payouts today. No
                third-party lender: your buyer’s approved US dollars, released early against an invoice you both already
                trust.
              </p>
              <div className="lp-actions wk-hero__actions">
                <Link href="/signup?interest=financing" className="lp-btn lp-btn--gold lp-btn--lg">Register financing interest</Link>
                <Link href="/" className="lp-btn lp-btn--ghost lp-btn--lg">See live settlement first</Link>
              </div>
              <dl className="wk-facts">
                {heroFacts.map((f) => (
                  <div key={f.k}>
                    <dt>{f.k}</dt>
                    <dd>{f.v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <ReceivableCard />
          </div>
        </div>
      </section>

      <section className="lp-sec lp-sec--flush">
        <div className="lp-wrap">
          <Head
            number="01"
            label="The receivable"
            title="An invoice that carries"
            accent="its own settlement history."
            lede="A Receivable would be an invoice object that remembers how it gets paid: who approved it, on what rail, with what proof. History a lender would charge you to underwrite, your buyer can simply read."
          />
          <Cards items={receivable} />
        </div>
      </section>

      <section className="lp-sec lp-sec--flush">
        <div className="lp-wrap">
          <Head
            number="02"
            label="Buyer-funded discounting"
            title="Early payment,"
            accent="without a lender."
            lede="Dynamic discounting is a trade between two parties who already trust each other: the buyer puts idle US dollars to work, the supplier turns a due date into cash flow. Splash would only referee the exchange."
          />
          <Cards items={discounting} />
        </div>
      </section>

      <section className="lp-sec lp-sec--flush">
        <div className="lp-wrap">
          <Head
            number="03"
            label="Where Supply fits"
            title="One rail,"
            accent="three loops."
            lede="Settle is live and feeds the loop with verified counterparties and settlement history. Supply would compound it into working capital. Save keeps idle balances tidy in between."
          />
          <div className="lp-grid3">
            {loops.map((loop) => (
              <article className="lp-card lp-card--hover wk-loop" key={loop.name}>
                <div className="lp-card__top">
                  <h3 className="wk-loop__name">
                    {loop.name} <span>{loop.role}</span>
                  </h3>
                  {loop.live ? <span className="lp-tag lp-tag--ok lp-tag--live">Live</span> : <span className="lp-tag lp-tag--coral">Roadmap</span>}
                </div>
                <p className="lp-card__copy">{loop.copy}</p>
                <span className="lp-tags">
                  {loop.foot.map((item) => (
                    <span className="lp-tag" key={typeof item === 'string' ? item : `${item.from}-${item.to}`}>
                      {typeof item === 'string' ? (
                        item
                      ) : (
                        <span className="lp-codes">
                          {item.from}
                          <ArrowRight size={14} role="img" aria-label="to" />
                          {item.to}
                        </span>
                      )}
                    </span>
                  ))}
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec lp-sec--flush" aria-labelledby="wk-close">
        <div className="lp-wrap">
          <div className="lp-band wk-close">
            <div>
              <p className="lp-kick">Shape the build order</p>
              <h2 className="lp-h-clean" id="wk-close">
                Early interest decides <em>which corridor is first.</em>
              </h2>
              <p className="wk-legal">
                Dynamic discounting is a coming capability, subject to licensing. Registering interest does not create a
                financing commitment; it tells us which corridors to build first.
              </p>
            </div>
            <div className="wk-close__actions">
              <Link href="/signup?interest=financing" className="lp-btn lp-btn--gold lp-btn--lg">Register financing interest</Link>
              <Link href="/" className="lp-btn lp-btn--ghost lp-btn--lg">See live settlement</Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="wc-footer">
        <div className="iso-shell wc-footer-inner">
          <span>{BRAND.copyright()}</span>
          <span>Supply loop: roadmap · Settle loop: sandbox on Solana devnet</span>
        </div>
      </footer>
    </main>
  );
}
