'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import HeroCoinFlight from '@/components/landing/HeroCoinFlight';
import { BEATS, BeatKicker, SAMPLE_RECEIPT_HREF } from '@/components/landing/HeroStory';

/**
 * The landing hero on a phone (prompt 12 §2.3, decision 3): its own layout, not the desktop story
 * shrunk. No pinned scroll: the hero block, then the four beats as cards on a rail that snaps, with
 * dots under it and a counter that follows the swipe. No product cards on phones.
 *
 * `serverPhone` is the server's user-agent decision (app/page.tsx): then this is the only hero sent and
 * its image is the one preloaded. On a narrow desktop window it is the CSS backstop, shown under 700 px.
 */
export default function HeroStoryPhone({ serverPhone = false }: { serverPhone?: boolean }) {
  const rail = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const steps = BEATS.slice(1);
  const start = BEATS[0];

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    let frame = 0;
    function measure() {
      frame = 0;
      const card = el!.firstElementChild as HTMLElement | null;
      if (!card) return;
      const gap = Number.parseFloat(getComputedStyle(el!).columnGap) || 0;
      const next = Math.round(el!.scrollLeft / (card.offsetWidth + gap));
      setAt(Math.min(steps.length - 1, Math.max(0, next)));
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }
    el.addEventListener('scroll', schedule, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      el.removeEventListener('scroll', schedule);
    };
  }, [steps.length]);

  function goTo(index: number) {
    const el = rail.current;
    const card = el?.children[index] as HTMLElement | undefined;
    if (!el || !card) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The rail is the cards' offset parent (position: relative), so this centres the card the way the snap does.
    el.scrollTo({ left: card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
  }

  return (
    <section className="lp-mstory">
      <div className="lp-mhero">
        {/* No kicker over the opening headline: it only repeated it (Sky, 21 Oct). */}
        <h1 className="iso-display lp-display lp-display--phone">
          <span className="lp-sr">{`${start.title} ${start.accent}`}</span>
          {start.lines.map((line) => (
            <span className="lp-line" aria-hidden="true" key={line}>
              {line}
            </span>
          ))}
          <span aria-hidden="true">{start.accent}</span>
        </h1>
        <p className="lp-lede">{start.lede}</p>
        <div className="lp-mhero__actions">
          <Link href="/signup" className="lp-btn lp-btn--dark lp-btn--lg">Open payment desk</Link>
          <a href="#how-it-works" className="lp-btn lp-btn--quiet lp-btn--lg">See how it works</a>
        </div>
        {/* The map and its coins in flight: the box is the picture's own size, so the coins land where it draws. */}
        <div className="lp-mhero__map">
          <Image
            src={start.art.src}
            alt={start.art.alt}
            width={start.art.width}
            height={start.art.height}
            sizes="320px"
            className="lp-mhero__art"
            preload={serverPhone}
          />
          <HeroCoinFlight active phone />
        </div>
      </div>

      <div className="lp-mrail__head">
        <h2>How a payment goes</h2>
        <span aria-hidden="true">{`${at + 1} / ${steps.length}`}</span>
      </div>
      <div className="lp-mrail" ref={rail}>
        {steps.map((b, index) => (
          <article key={b.id} id={`lp-mcard-${b.id}`} className="lp-mcard" role="tabpanel" aria-label={`${b.number}, ${b.label}`}>
            <Image src={b.art.src} alt={b.art.alt} width={b.art.width} height={b.art.height} sizes="300px" className="lp-mcard__art" />
            <BeatKicker beat={b} />
            <h3 className="lp-mcard__title">
              {b.title} <em>{b.accent}</em>
            </h3>
            <p>{b.lede}</p>
            {index === steps.length - 1 ? (
              <Link href={SAMPLE_RECEIPT_HREF} className="lp-btn lp-btn--quiet">Verify a sample receipt</Link>
            ) : null}
          </article>
        ))}
      </div>
      <div className="lp-mdots" role="tablist" aria-label="Steps">
        {steps.map((b, index) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={index === at}
            aria-controls={`lp-mcard-${b.id}`}
            aria-label={`${b.number}, ${b.label}`}
            onClick={() => goTo(index)}
          />
        ))}
      </div>
    </section>
  );
}
