'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

/**
 * The landing hero on a desktop (prompt 12 §2.2, preview tab 1): one pinned story in five beats. The
 * section is 420vh tall and its stage sticks for the whole of it; the beat on show is
 * floor(progress × 5), read from a passive scroll listener once per animation frame. Copy crossfades
 * and lifts, the art scales in; the timings live in styles/landing-p12.css. With reduced motion nothing
 * is pinned and the five beats stack as plain sections. Phones get HeroStoryPhone instead.
 *
 * Sky, 21 Oct: no step rail, a "Scroll to settle" cue instead (as on v1), and each step after the first
 * brings in one coin, its currency picked at random and never the same twice in a row.
 */

export type Beat = {
  id: string;
  /** The number chip ("01"), none on the opening beat. */
  number?: string;
  label: string;
  /** The headline as a sentence, for screen readers; `lines` is how it breaks on screen. */
  title: string;
  lines: string[];
  accent: string;
  lede: string;
  art: { src: string; width: number; height: number };
};

export const BEATS: Beat[] = [
  {
    id: 'start',
    label: 'Pay suppliers abroad',
    title: 'Pay suppliers abroad.',
    lines: ['Pay', 'suppliers', 'abroad.'],
    accent: 'Prove every payment.',
    // Sky, 21 Oct: cross-border, not one corridor; easy to send (a speed claim is banned until it can be shown); solid proof.
    lede: 'Pay suppliers and clients across borders, straight from your own business account. Easy to send, delivered to their bank, and proven by a receipt anyone can check. Splash never holds the money.',
    // Sky's map of Southeast Asia (21 Oct, Sky's own cut-out), in place of the district: the region the payments cross.
    art: { src: '/isometric/gen/hero-sea-map.webp', width: 1800, height: 1223 },
  },
  {
    id: 'invoice',
    number: '01',
    label: 'An invoice arrives',
    title: 'Zeke reads the invoice.',
    lines: ['Zeke reads', 'the invoice.'],
    accent: 'You check it.',
    lede: 'Drop a supplier’s invoice. Zeke fills in the payment and shows the line each field came from. It reads with no tools, so a document can’t make it do anything.',
    art: { src: '/isometric/gen/hero-01-zeke-reads-invoice.webp', width: 892, height: 831 },
  },
  {
    id: 'approve',
    number: '02',
    label: 'A person approves',
    title: 'Zeke drafts. A person approves.',
    lines: ['Zeke drafts.', 'A person approves.'],
    accent: 'On your device.',
    lede: 'Eight rules run as code before the approval card appears. The quote stays fresh for sixty seconds. Nobody at Splash can press this button.',
    art: { src: '/isometric/gen/hero-02-person-approves.webp', width: 960, height: 818 },
  },
  {
    id: 'routes',
    number: '03',
    label: 'Two routes',
    title: 'Two routes. Same pesos.',
    lines: ['Two routes.', 'Same pesos.'],
    accent: 'You pick.',
    lede: 'Two routes, ranked by what the supplier receives, with both fees shown before you choose. Dollars travel as USDC to the payout partner, who pays the bank in pesos.',
    art: { src: '/isometric/gen/hero-03-two-routes.webp', width: 960, height: 608 },
  },
  {
    id: 'product',
    number: '04',
    label: 'The product',
    title: 'Payments are the feature.',
    lines: ['Payments are', 'the feature.'],
    accent: 'Proof is the product.',
    lede: 'One receipt: invoice, approval, route, rate and bank reference, with its proof recorded. Verify it in the browser. Change one field and it fails.',
    art: { src: '/isometric/gen/hero-04-receipt-proof.webp', width: 728, height: 935 },
  },
];

/** Where "Verify a sample receipt" goes: no public sample receipt exists yet, so the Trust page's
 *  account of how anyone holding a receipt checks it (a default Sky can overrule; Phase 2 PR). */
export const SAMPLE_RECEIPT_HREF = '/trust#trust-evidence';

/** The illustrative receipt number on the last beat: §5.1's format, the demo transfer's. */
const SAMPLE_RECEIPT_NUMBER = 'SPL-R-20261018-6512F659';

/** The coins a step can bring in (Sky's list; a VND coin joins when its art exists). Each picture's coin
 *  fills a different share of its square, so each has its own class that sizes it to the same coin. */
const COINS = [
  { id: 'usd', src: '/cinematic/token-usd.png' },
  { id: 'myr', src: '/cinematic/token-myr.png' },
  { id: 'php', src: '/cinematic/token-php.png' },
  { id: 'idr', src: '/cinematic/token-idr-v1.png' },
] as const;

type Coin = { key: number; id: (typeof COINS)[number]['id']; src: string; side: 'left' | 'right' };

export function BeatKicker({ beat }: { beat: Beat }) {
  return (
    <p className="lp-kick">
      {beat.number ? <span className="lp-num">{beat.number}</span> : null}
      {beat.label}
    </p>
  );
}

function BeatHeadline({ beat, level }: { beat: Beat; level: 1 | 2 }) {
  const Tag = level === 1 ? 'h1' : 'h2';
  return (
    <Tag className={`iso-display lp-display ${level === 1 ? 'lp-display--hero' : 'lp-display--beat'}`}>
      <span className="lp-sr">{`${beat.title} ${beat.accent}`}</span>
      {beat.lines.map((line) => (
        <span className="lp-line" aria-hidden="true" key={line}>
          {line}
        </span>
      ))}
      <span aria-hidden="true">{beat.accent}</span>
    </Tag>
  );
}

/** The small product card beside each beat's art (desktop only). */
function FloatCard({ id }: { id: string }) {
  if (id === 'invoice') {
    return (
      <>
        <div className="lp-float__head">
          <strong>Check the invoice</strong>
          <span className="lp-tag lp-tag--amber">From line 12</span>
        </div>
        <div className="lp-row"><span>Amount</span><strong>₱287,000.00</strong></div>
        <div className="lp-row"><span>Bank</span><strong>BDO •••• 4471</strong></div>
      </>
    );
  }
  if (id === 'approve') {
    return (
      <>
        <div className="lp-row"><span>Rules</span><strong className="lp-ok">8 of 8 pass</strong></div>
        <div className="lp-row"><span>You pay</span><strong>US$5,012.50</strong></div>
        {/* A picture of the approval card: it does nothing and is skipped by keyboard and screen readers. */}
        <button type="button" className="lp-btn lp-btn--approve lp-float__approve" tabIndex={-1} aria-hidden="true">
          Approve on this device
        </button>
      </>
    );
  }
  if (id === 'routes') {
    return (
      <>
        <div className="lp-float__route">
          <span className="lp-tag lp-tag--ok">Cheapest</span>
          <strong>US$12.50 in fees</strong>
        </div>
        <div className="lp-float__route">
          <span className="lp-tag lp-tag--gold">Straight to the partner</span>
          <strong>same ₱287,000.00</strong>
        </div>
        <div className="lp-float__wire" aria-hidden="true"><i /><i /></div>
      </>
    );
  }
  if (id === 'product') {
    return (
      <>
        <div className="lp-float__head">
          <strong className="lp-mono">{SAMPLE_RECEIPT_NUMBER}</strong>
          <span className="lp-tag lp-tag--ok"><Check aria-hidden="true" />Verifies</span>
        </div>
        <div className="lp-row"><span>They received</span><strong>₱287,000.00</strong></div>
        <div className="lp-row"><span>You paid</span><strong>US$5,012.50</strong></div>
      </>
    );
  }
  return null;
}

export default function HeroStory() {
  const ref = useRef<HTMLElement>(null);
  const [beat, setBeat] = useState(0);
  const [stacked, setStacked] = useState(false);
  const [coin, setCoin] = useState<Coin | null>(null);
  const shown = useRef({ beat: 0, coin: null as Coin | null });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;

    function measure() {
      frame = 0;
      setStacked(reduce.matches);
      // Hidden (a narrow window gets the phone hero) or not pinned (reduced motion): nothing to follow.
      if (reduce.matches || el!.offsetParent === null) return;
      const top = el!.getBoundingClientRect().top;
      const range = el!.offsetHeight - window.innerHeight;
      const progress = range > 0 ? Math.min(1, Math.max(0, -top / range)) : 0;
      el!.style.setProperty('--lp-progress', progress.toFixed(4));
      const next = Math.min(BEATS.length - 1, Math.floor(progress * BEATS.length));
      if (next === shown.current.beat) return;
      shown.current.beat = next;
      setBeat(next);
      // A step after the first brings in a coin: a random currency, never the last one shown, on
      // alternate sides of the picture. Picked here, in the browser, so the server's page never differs.
      const last = shown.current.coin;
      const choices = COINS.filter((c) => c.id !== last?.id);
      const pick = choices[Math.floor(Math.random() * choices.length)];
      shown.current.coin = next === 0 ? last : { key: (last?.key ?? 0) + 1, id: pick.id, src: pick.src, side: next % 2 ? 'right' : 'left' };
      setCoin(next === 0 ? null : shown.current.coin);
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    reduce.addEventListener('change', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      reduce.removeEventListener('change', schedule);
    };
  }, []);

  const stateOf = (index: number) => (index === beat ? 'current' : index < beat ? 'past' : 'next');

  return (
    <section ref={ref} className="lp-story" aria-label="How a payment goes, in five steps">
      <div className="lp-story__pin">
        <div className="lp-story__progress" aria-hidden="true"><i /></div>
        {/* The cue reads as a picture of what to do; the steps themselves are plain headings to a screen reader. */}
        <p className="lp-cue" aria-hidden="true" data-done={beat === BEATS.length - 1 ? '' : undefined}>
          <span className="lp-cue__wheel" />
          Scroll to settle
        </p>

        <div className="lp-story__beats">
          {BEATS.map((b, index) => (
            <article
              key={b.id}
              className="lp-beat"
              data-state={stateOf(index)}
              // Off-screen beats can't take focus while pinned; stacked (reduced motion), every beat is live.
              inert={!stacked && index !== beat}
            >
              <div className="lp-beat__copy">
                {/* The opening beat's kicker only repeated its headline (Sky, 21 Oct). */}
                {index === 0 ? null : <BeatKicker beat={b} />}
                <BeatHeadline beat={b} level={index === 0 ? 1 : 2} />
                <p className="lp-lede">{b.lede}</p>
                {index === 0 ? (
                  <div className="lp-actions">
                    <Link href="/signup" className="lp-btn lp-btn--dark lp-btn--lg">Open payment desk</Link>
                    <a href="#how-it-works" className="lp-btn lp-btn--quiet lp-btn--lg">See how it works</a>
                  </div>
                ) : null}
                {index === BEATS.length - 1 ? (
                  <div className="lp-actions">
                    <Link href="/signup" className="lp-btn lp-btn--dark lp-btn--lg">Open payment desk</Link>
                    <Link href={SAMPLE_RECEIPT_HREF} className="lp-btn lp-btn--quiet lp-btn--lg">Verify a sample receipt</Link>
                  </div>
                ) : null}
              </div>

              <div className="lp-beat__stage">
                <div className={`lp-beat__art${index === 0 ? ' lp-beat__art--opening' : ''}`}>
                  <Image
                    src={b.art.src}
                    alt=""
                    width={b.art.width}
                    height={b.art.height}
                    sizes={index === 0 ? '(max-width: 1000px) 92vw, 44vw' : '(max-width: 1000px) 60vw, 34vw'}
                    preload={index === 0}
                  />
                  {index === 0 ? (
                    <>
                      <Image src="/cinematic/token-usd.png" alt="" width={1024} height={1024} sizes="(max-width: 1000px) 160px, 13vw" className="lp-token lp-token--usd" />
                      <Image src="/cinematic/token-php.png" alt="" width={1024} height={1024} sizes="(max-width: 1000px) 118px, 10vw" className="lp-token lp-token--php" />
                    </>
                  ) : null}
                  {index > 0 && index === beat && coin ? (
                    // Keyed by the pick, so each new coin plays its entrance once; the picture bobs inside it.
                    <span className={`lp-coin lp-coin--${coin.side} lp-coin--${coin.id}`} key={coin.key} aria-hidden="true">
                      <Image src={coin.src} alt="" width={1024} height={1024} sizes="16vw" className="lp-token" />
                    </span>
                  ) : null}
                </div>
                {index > 0 ? (
                  <div className="lp-float" aria-hidden="true">
                    <FloatCard id={b.id} />
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
