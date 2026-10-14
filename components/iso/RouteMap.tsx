// iso-ui
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, type CSSProperties, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

/**
 * Look 9's signature (§2.3): a row of stations joined by wires. Coins travel a wire only while money
 * really moves there: a route chosen before approval, or a payment actually in flight after. A quiet
 * wire (grey, no coins) means nothing is moving. A station a route skips is removed with a short
 * fade, never greyed in place. On a phone the row scrolls, with the current station centred.
 */
export function RouteMap({ label, children, className, wireTop }: { label: string; children: ReactNode; className?: string; /** Where the wire meets the stations' art, in px. */ wireTop?: number }) {
  return (
    // Focusable: on a phone the row scrolls sideways, and a keyboard must be able to scroll it too.
    <div className={clsx('iso-routemap', className)} role="group" aria-label={label} tabIndex={0} style={wireTop ? ({ '--wire-top': `${wireTop}px` } as CSSProperties) : undefined}>
      {children}
    </div>
  );
}

export type WireState = 'quiet' | 'active' | 'done';

export function Wire({ state = 'quiet' }: { state?: WireState }) {
  return (
    <div className={clsx('iso-wire', `iso-wire--${state}`)} aria-hidden="true" data-wire={state}>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" focusable="false">
        <line x1="0" y1="15" x2="100" y2="15" vectorEffect="non-scaling-stroke" />
      </svg>
      {state === 'active' ? (
        <>
          <span className="iso-coin" />
          <span className="iso-coin" />
        </>
      ) : null}
    </div>
  );
}

/** The art a station stands on. */
export type StationArt =
  | { kind: 'coin'; coin: 'usd' | 'php'; size?: number; late?: boolean }
  | { kind: 'block'; glyph: BlockGlyph; size?: number }
  | { kind: 'tile'; value: string; tone?: 'quiet' | 'live' | 'coral' | 'ok' | 'now' | 'done' }
  | { kind: 'proof'; tone?: 'quiet' | 'ok' }
  | { kind: 'vault'; size?: number }
  | { kind: 'custom'; node: ReactNode };

export type BlockGlyph = 'arrow' | 'partner' | 'bank' | 'reserve' | 'invest' | 'business' | 'none';

const COIN_SRC = { usd: '/cinematic/token-usd.png', php: '/cinematic/token-php.png' } as const;

function Art({ art }: { art: StationArt }) {
  switch (art.kind) {
    case 'coin': {
      const w = art.size ?? 92;
      // The coin art is square (1024 × 1024).
      return <Image className={clsx('iso-art iso-station__art iso-bob', art.late && 'iso-bob--late')} src={COIN_SRC[art.coin]} alt="" width={w} height={w} />;
    }
    case 'vault': {
      const w = art.size ?? 120;
      // The vault art is 1377 × 768.
      return <Image className="iso-art iso-station__art iso-bob iso-bob--slow" src="/cinematic/vault-transparent.png" alt="" width={w} height={Math.round((w * 768) / 1377)} />;
    }
    case 'block':
      return <IsoBlock glyph={art.glyph} size={art.size} />;
    case 'tile':
      return <span className={clsx('iso-station__tile', art.tone && art.tone !== 'quiet' && `iso-station__tile--${art.tone}`)}>{art.value}</span>;
    case 'proof':
      return (
        <span className={clsx('iso-station__tile', art.tone === 'ok' && 'iso-station__tile--ok')}>
          <ShieldCheck size={28} strokeWidth={2.4} aria-hidden="true" />
        </span>
      );
    case 'custom':
      return <>{art.node}</>;
  }
}

/**
 * A station: its art, a label, an amount and one line of help. With `href` the whole station is a
 * link (Overview's pipeline opens History filtered to that state).
 */
export function Station({
  art,
  label,
  amount,
  help,
  href,
  wide,
  current,
  className,
  children,
}: {
  art: StationArt;
  label: ReactNode;
  amount?: ReactNode;
  help?: ReactNode;
  href?: string;
  wide?: boolean;
  /** The station the payment is at: scrolled into the middle on a phone. */
  current?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      <Art art={art} />
      <strong className="iso-station__label">{label}</strong>
      {amount != null ? <span className="iso-station__amount">{amount}</span> : null}
      {help != null ? <span className="iso-station__help">{help}</span> : null}
      {children}
    </>
  );
  const cls = clsx('iso-station', wide && 'iso-station--wide', href && 'iso-station--link', className);
  // Centre the current station in its row once, when it becomes current. Only the row scrolls
  // sideways; the page never jumps.
  const centre = useCallback((el: HTMLElement | null) => {
    const row = el?.closest<HTMLElement>('.iso-routemap');
    if (!el || !row || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = Math.max(0, el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2);
  }, []);
  const ref = current ? centre : undefined;
  if (href) {
    return (
      <Link href={href} className={cls} ref={ref} aria-current={current ? 'step' : undefined}>
        {body}
      </Link>
    );
  }
  return (
    <div className={cls} ref={ref} aria-current={current ? 'step' : undefined}>
      {body}
    </div>
  );
}

/**
 * A stretch of the route that only some routes use (the partner's lower-cost lane): a station and
 * the wire after it, faded in when the chosen route uses it and out when it doesn't.
 */
export function Hop({ show, children }: { show: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="hop"
          style={{ display: 'flex', alignItems: 'flex-start', flex: '1 1 210px', minWidth: 200 }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.12 : 0.24, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

const GLYPH: Record<Exclude<BlockGlyph, 'none'>, ReactNode> = {
  // The partner's lower-cost lane: an arrow along the top face.
  arrow: <path d="M44 34h32M68 27l8 7-8 7" fill="none" className="iso-block-line" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />,
  // The payout partner: a small roof.
  partner: <path d="M48 38l12-14 12 14z" className="iso-block-top iso-block-line" strokeWidth="2" strokeLinejoin="round" />,
  // A bank: three columns under a pediment.
  bank: <path d="M46 36l14-9 14 9M50 36v6M60 36v6M70 36v6" fill="none" className="iso-block-line" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  // The reserve: a shield.
  reserve: <path d="M60 22l10 4v6c0 6-4 9-10 11-6-2-10-5-10-11v-6z" className="iso-block-top iso-block-line" strokeWidth="2" strokeLinejoin="round" />,
  // Investments: a rising step.
  invest: <path d="M46 42l8-7 6 4 12-11M66 28h6v6" fill="none" className="iso-block-line" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  // Another business on Splash: two linked squares.
  business: <path d="M48 30h10v10H48zM62 30h10v10H62zM58 35h4" fill="none" className="iso-block-line" strokeWidth="2" strokeLinejoin="round" />,
};

/** The isometric block (dimetric 2:1): paper top, mint left face, teal right face, ink outline. */
export function IsoBlock({ glyph = 'none', size = 110 }: { glyph?: BlockGlyph; size?: number }) {
  return (
    <svg className="iso-station__art" width={size} height={Math.round((size * 92) / 110)} viewBox="0 0 120 100" aria-hidden="true" focusable="false">
      <path d="M60 10L110 35 60 60 10 35Z" className="iso-block-top iso-block-line" />
      <path d="M10 35L60 60 60 90 10 65Z" className="iso-block-left iso-block-line" />
      <path d="M60 60L110 35 110 65 60 90Z" className="iso-block-right iso-block-line" />
      {glyph !== 'none' ? GLYPH[glyph] : null}
    </svg>
  );
}
