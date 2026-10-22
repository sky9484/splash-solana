'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

import HeroCoinFlight from '@/components/landing/HeroCoinFlight';

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
  /** `alt` describes the picture; an empty one marks it decorative. */
  art: { src: string; width: number; height: number; alt: string };
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
    // Sky's ASEAN map (art refresh, 22 Oct): one 2400 px source, next/image makes the smaller sizes. HeroCoinFlight
    // draws its coins over it in this picture's own 1600 x 1067 frame.
    art: { src: '/isometric/gen/hero-asean-map-2400.webp', width: 2400, height: 1600, alt: 'Map of the eleven ASEAN countries as floating islands joined by gold rails' },
  },
  {
    id: 'invoice',
    number: '01',
    label: 'An invoice arrives',
    title: 'Zeke reads the invoice.',
    lines: ['Zeke reads', 'the invoice.'],
    accent: 'You check it.',
    lede: 'Drop a supplier’s invoice. Zeke fills in the payment and shows the line each field came from. It reads with no tools, so a document can’t make it do anything.',
    art: { src: '/isometric/gen/hero-01-zeke-reads-invoice-v2.webp', width: 1400, height: 1363, alt: 'Zeke reads the invoice from inside a glass booth; three highlighted lines fill the payment form' },
  },
  {
    id: 'approve',
    number: '02',
    label: 'A person approves',
    title: 'Zeke drafts. A person approves.',
    lines: ['Zeke drafts.', 'A person approves.'],
    accent: 'On your device.',
    lede: 'Eight rules run as code before the approval card appears. The quote stays fresh for sixty seconds. Nobody at Splash can press this button.',
    // Sky's new door (art refresh, 22 Oct): exactly eight lamps, one per rule in the lede.
    art: { src: '/isometric/gen/hero-02-person-approves-v2.webp', width: 1079, height: 1400, alt: 'A vault door with eight lit lamps, opened by a phone in the keyhole; a locked laptop sits beside it' },
  },
  {
    id: 'routes',
    number: '03',
    label: 'Two routes',
    title: 'Two routes. Same pesos.',
    lines: ['Two routes.', 'Same pesos.'],
    accent: 'You pick.',
    lede: 'Two routes, ranked by what the supplier receives, with both fees shown before you choose. Dollars travel as USDC to the payout partner, who pays the bank in pesos.',
    art: { src: '/isometric/gen/hero-03-two-routes-v2.webp', width: 1400, height: 1238, alt: 'Two rail routes, one over a bridge and one through a toll gate, both end at the same bank with equal peso stacks' },
  },
  {
    id: 'product',
    number: '04',
    label: 'The product',
    title: 'Payments are the feature.',
    lines: ['Payments are', 'the feature.'],
    accent: 'Proof is the product.',
    lede: 'One receipt: invoice, approval, route, rate and bank reference, with its proof recorded. Verify it in the browser. Change one field and it fails.',
    art: { src: '/isometric/gen/hero-04-receipt-proof-v2.webp', width: 1263, height: 1400, alt: 'Two receipt towers: the intact one is lit; the one with a single field pulled out is dark and its seal is broken' },
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
                    alt={b.art.alt}
                    width={b.art.width}
                    height={b.art.height}
                    sizes={index === 0 ? '(max-width: 1000px) 92vw, 44vw' : '(max-width: 1000px) 60vw, 34vw'}
                    preload={index === 0}
                  />
                  {index === 0 ? (
                    <>
                      {/* Coins fly between the map's countries while the opening beat is the one showing. */}
                      {/* No floating USD and PHP tokens here: the map draws its own $ and EUR corner coins, and the old
                          tokens sat on top of the EUR one. */}
                      <HeroCoinFlight active={beat === 0} />
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
