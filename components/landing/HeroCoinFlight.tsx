// iso-ui
'use client';

import { useEffect, useRef } from 'react';

/**
 * Coins in flight over the hero's opening map (Sky's art refresh, 22 Oct). Gold coins arc between the map's
 * countries, spinning as they go; at the midpoint each one turns into the destination's currency, and it
 * lands with a gold ring. About three in ten start at the two big coins drawn on the map's top corners
 * ($ and €): money arriving from abroad. The rest are hops between neighbours.
 *
 * One SVG over the picture, in the picture's own 1600 x 1067 frame (hero-asean-map, every size shares the
 * crop), driven by requestAnimationFrame. React renders the empty <svg>; the coins are drawn and removed by
 * hand in the effect, so the server's page never differs and the DOM never grows. It runs only while the
 * opening beat is showing, the map is on screen and the tab is visible, and it pauses without resetting.
 * With reduced motion it draws four coins standing still mid-flight. Colours are the landing's tokens
 * (styles/landing-p12.css, the .lp-cf classes).
 */

type Place = { x: number; y: number; symbol: string };

/** Landing points in the 1600 x 1067 frame, and each country's currency sign. */
const COUNTRIES: Record<string, Place> = {
  MM: { x: 215, y: 205, symbol: 'K' },
  LA: { x: 535, y: 185, symbol: '₭' },
  TH: { x: 395, y: 372, symbol: '฿' },
  KH: { x: 665, y: 478, symbol: '៛' },
  VN: { x: 832, y: 335, symbol: '₫' },
  MY: { x: 428, y: 690, symbol: 'RM' },
  SG: { x: 566, y: 765, symbol: 'S$' },
  BN: { x: 1072, y: 662, symbol: 'B$' },
  PH: { x: 1487, y: 422, symbol: '₱' },
  ID: { x: 975, y: 928, symbol: 'Rp' },
  TL: { x: 1505, y: 932, symbol: '$' },
};

/** The two coins the map draws on its top corners: money arriving from abroad. */
const ABROAD: Record<string, Place> = {
  USD: { x: 85, y: 88, symbol: '$' },
  EUR: { x: 1517, y: 92, symbol: '€' },
};

const LINKS: ReadonlyArray<readonly [string, string]> = [
  ['MM', 'LA'], ['MM', 'TH'], ['LA', 'TH'], ['LA', 'VN'], ['TH', 'KH'], ['KH', 'VN'],
  ['TH', 'MY'], ['KH', 'MY'], ['MY', 'SG'], ['SG', 'ID'], ['ID', 'BN'], ['BN', 'PH'],
  ['VN', 'PH'], ['ID', 'TL'], ['MY', 'BN'], ['SG', 'PH'], ['MY', 'ID'], ['TH', 'VN'],
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const R = 34; // a coin's radius at scale 1, in frame units
const LIFT = 30; // a coin flies about this far above its landing point
const ABROAD_SHARE = 0.3;

type Flight = {
  key: string;
  from: Place;
  to: Place;
  t0: number; // ms on the flight clock
  dur: number; // ms
  arc: number;
  landed: number | null; // ms on the flight clock, once it lands
  group: SVGGElement;
  ground: SVGEllipseElement;
  coin: SVGGElement;
  text: SVGTextElement;
  swapped: boolean;
};

type Ring = { el: SVGCircleElement; t0: number; dur: number; r0: number; r1: number; w: number };

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** A coin: the darker edge offset to the lower right, the gold face, a thin inner rim, the sign. */
function drawCoin(symbol: string): { coin: SVGGElement; text: SVGTextElement } {
  const coin = el('g', { class: 'lp-cf-coin' });
  coin.append(
    el('circle', { class: 'lp-cf-edge', cx: 3, cy: 4, r: R }),
    el('circle', { class: 'lp-cf-face', r: R }),
    el('circle', { class: 'lp-cf-rim', r: R * 0.78 }),
  );
  const text = el('text', { class: 'lp-cf-sym', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  setSymbol(text, symbol);
  coin.append(text);
  return { coin, text };
}

/** A sign of two or more characters ("RM", "S$") is set smaller so it fits the face. */
function setSymbol(text: SVGTextElement, symbol: string) {
  text.textContent = symbol;
  text.setAttribute('font-size', String(symbol.length > 1 ? R * 0.74 : R * 1.08));
}

/** Where a flight is at eased progress `e`: the coin, its scale and spin, and the point on the ground under it. */
function pose(f: Pick<Flight, 'from' | 'to' | 'arc'>, e: number) {
  const x = f.from.x + (f.to.x - f.from.x) * e;
  const ground = f.from.y + (f.to.y - f.from.y) * e;
  const rise = f.arc * 4 * e * (1 - e);
  const scale = 0.62 + 0.18 * Math.sin(Math.PI * e); // 0.62 at take-off, 0.80 at the top of the arc
  const spin = Math.max(0.06, Math.abs(Math.cos(2 * Math.PI * 2 * e))); // two full turns, an X-scale flip
  const high = f.arc > 0 ? rise / f.arc : 0;
  return { x, y: ground - LIFT - rise, ground, scale, spin, shade: 1 - 0.55 * high };
}

function placeCoin(group: SVGGElement, coin: SVGGElement, ground: SVGEllipseElement, p: ReturnType<typeof pose>, fade = 1) {
  coin.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${(p.spin * p.scale).toFixed(3)} ${p.scale.toFixed(3)})`);
  ground.setAttribute('cx', p.x.toFixed(1));
  ground.setAttribute('cy', p.ground.toFixed(1));
  ground.setAttribute('rx', (R * 0.9 * p.scale * p.shade).toFixed(1));
  ground.setAttribute('ry', (R * 0.3 * p.scale * p.shade).toFixed(1));
  ground.setAttribute('opacity', (0.9 * p.shade * fade).toFixed(2));
  group.setAttribute('opacity', fade.toFixed(2));
}

const distance = (a: Place, b: Place) => Math.hypot(b.x - a.x, b.y - a.y);
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** The still frame for reduced motion: four coins caught mid-flight, two of them already converted. */
const STILL: ReadonlyArray<readonly [Place, Place, number]> = [
  [ABROAD.EUR, COUNTRIES.PH, 0.42],
  [COUNTRIES.MY, COUNTRIES.SG, 0.55],
  [COUNTRIES.LA, COUNTRIES.VN, 0.38],
  [COUNTRIES.ID, COUNTRIES.BN, 0.6],
];

export default function HeroCoinFlight({ active, phone = false }: { active: boolean; phone?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const activeRef = useRef(active);
  const syncRef = useRef<() => void>(() => {});

  // The opening beat comes and goes as the story scrolls: start or pause without resetting.
  useEffect(() => {
    activeRef.current = active;
    syncRef.current();
  }, [active]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const interval = phone ? 1600 : 800;
    const cap = phone ? 4 : 8;

    const flights: Flight[] = [];
    const rings: Ring[] = [];
    let clock = 0; // ms the animation has actually run; it stands still while paused
    let nextLaunch = 0;
    let lastKey = '';
    let last = 0;
    let frame = 0;
    let inView = false;
    let still = false;

    function clear() {
      flights.length = 0;
      rings.length = 0;
      svg!.replaceChildren();
    }

    function ring(x: number, y: number, kind: 'land' | 'lift') {
      const node = el('circle', { class: kind === 'land' ? 'lp-cf-ring-land' : 'lp-cf-ring-lift', cx: x, cy: y, r: 0 });
      svg!.append(node);
      rings.push(kind === 'land'
        ? { el: node, t0: clock, dur: 900, r0: R * 0.35, r1: R * 1.9, w: 3 }
        : { el: node, t0: clock, dur: 700, r0: R * 0.25, r1: R * 1.15, w: 2.5 });
    }

    function launch() {
      if (flights.filter((f) => f.landed === null).length >= cap) return;
      let from: Place;
      let to: Place;
      let key: string;
      do {
        if (Math.random() < ABROAD_SHARE) {
          const source = pick(Object.keys(ABROAD));
          const dest = pick(Object.keys(COUNTRIES));
          from = ABROAD[source];
          to = COUNTRIES[dest];
          key = `${source}-${dest}`;
        } else {
          const [a, b] = pick(LINKS);
          [from, to] = Math.random() < 0.5 ? [COUNTRIES[a], COUNTRIES[b]] : [COUNTRIES[b], COUNTRIES[a]];
          key = [a, b].sort().join('-');
        }
      } while (key === lastKey);
      lastKey = key;

      const d = distance(from, to);
      const group = el('g', { class: 'lp-cf-flight' });
      const ground = el('ellipse', { class: 'lp-cf-ground' });
      const { coin, text } = drawCoin(from.symbol);
      group.append(ground, coin);
      svg!.append(group);
      const f: Flight = { key, from, to, t0: clock, dur: (1.3 + d * 0.0012) * 1000, arc: 90 + d * 0.14, landed: null, group, ground, coin, text, swapped: false };
      flights.push(f);
      placeCoin(group, coin, ground, pose(f, 0));
      ring(from.x, from.y, 'lift');
    }

    function step(now: number) {
      frame = 0;
      clock += Math.min(64, now - last); // a long gap (a slow frame, a background tab) never jumps the coins
      last = now;

      while (clock >= nextLaunch) {
        launch();
        nextLaunch += interval;
      }

      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i];
        if (f.landed === null) {
          const t = Math.min(1, (clock - f.t0) / f.dur);
          const e = easeInOut(t);
          if (!f.swapped && e >= 0.5) {
            setSymbol(f.text, f.to.symbol);
            f.swapped = true;
          }
          placeCoin(f.group, f.coin, f.ground, pose(f, e));
          if (t >= 1) {
            f.landed = clock;
            ring(f.to.x, f.to.y, 'land');
          }
        } else {
          // Landed: the coin shrinks and fades over 0.4 s, then leaves the page.
          const k = Math.min(1, (clock - f.landed) / 400);
          const p = pose(f, 1);
          placeCoin(f.group, f.coin, f.ground, { ...p, scale: p.scale * (1 - 0.5 * k) }, 1 - k);
          if (k >= 1) {
            f.group.remove();
            flights.splice(i, 1);
          }
        }
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        const k = Math.min(1, (clock - r.t0) / r.dur);
        const ease = 1 - (1 - k) ** 2;
        r.el.setAttribute('r', (r.r0 + (r.r1 - r.r0) * ease).toFixed(1));
        r.el.setAttribute('stroke-width', (r.w * (1 - 0.7 * k)).toFixed(2));
        r.el.setAttribute('opacity', (0.9 * (1 - k)).toFixed(2));
        if (k >= 1) {
          r.el.remove();
          rings.splice(i, 1);
        }
      }

      frame = window.requestAnimationFrame(step);
    }

    function drawStill() {
      clear();
      for (const [from, to, e] of STILL) {
        const f = { from, to, arc: 90 + distance(from, to) * 0.14 };
        const group = el('g', { class: 'lp-cf-flight' });
        const ground = el('ellipse', { class: 'lp-cf-ground' });
        const { coin } = drawCoin(e >= 0.5 ? to.symbol : from.symbol);
        group.append(ground, coin);
        svg!.append(group);
        placeCoin(group, coin, ground, { ...pose(f, e), spin: 1 });
      }
      still = true;
    }

    function sync() {
      if (reduce.matches) {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        if (!still) drawStill();
        return;
      }
      if (still) {
        clear();
        still = false;
      }
      const run = activeRef.current && inView && !document.hidden;
      if (run && !frame) {
        last = performance.now();
        frame = window.requestAnimationFrame(step);
      } else if (!run && frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    }
    syncRef.current = sync;

    const observer = new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    observer.observe(svg);
    document.addEventListener('visibilitychange', sync);
    reduce.addEventListener('change', sync);
    sync();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reduce.removeEventListener('change', sync);
      syncRef.current = () => {};
      clear();
    };
  }, [phone]);

  return <svg ref={svgRef} className="lp-cf" viewBox="0 0 1600 1067" aria-hidden="true" focusable="false" />;
}
