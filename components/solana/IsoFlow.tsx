/**
 * Isometric diagram for the landing: the money path as three slabs on one grid.
 *   Your vault  →  Payout partner  →  Supplier's bank
 * Projection: true isometric (30°), one grid unit = U px, light from the top left
 * (top faces lightest, left faces mid, right faces darkest). The route is the only
 * teal line; the "You approve" marker is the only coral mark (design brief §2).
 * Labels stay flat (not skewed) so they read at any size.
 */
const U = 22;
const C = Math.cos(Math.PI / 6);

function pt(i: number, j: number, k = 0): [number, number] {
  return [(i - j) * C * U, (i + j) * 0.5 * U - k * U];
}
const P = (...a: [number, number, number?]) => pt(a[0], a[1], a[2] ?? 0).map((v) => v.toFixed(1)).join(',');

interface Slab {
  key: string;
  j0: number;
  h: number;
  label: string;
  caption: string;
}

const W = 3;
const D = 3;
const SLABS: Slab[] = [
  { key: 'bank', j0: 0, h: 1.4, label: "Supplier's bank", caption: 'Paid in pesos' },
  { key: 'partner', j0: 4.5, h: 0.7, label: 'Payout partner', caption: 'Mock partner · devnet' },
  { key: 'vault', j0: 9, h: 1, label: 'Your vault', caption: 'Your keys, on Solana' },
];

function SlabShape({ s }: { s: Slab }) {
  const { j0, h } = s;
  const top = [P(0, j0, h), P(W, j0, h), P(W, j0 + D, h), P(0, j0 + D, h)].join(' ');
  const left = [P(0, j0 + D, h), P(W, j0 + D, h), P(W, j0 + D, 0), P(0, j0 + D, 0)].join(' ');
  const right = [P(W, j0, h), P(W, j0 + D, h), P(W, j0 + D, 0), P(W, j0, 0)].join(' ');
  return (
    <g>
      <polygon points={left} className="iso-left" />
      <polygon points={right} className="iso-right" />
      <polygon points={top} className="iso-top" />
    </g>
  );
}

export function IsoFlow() {
  const centers = SLABS.map((s) => pt(W / 2, s.j0 + D / 2, s.h));
  const grid: string[] = [];
  for (let i = -1; i <= W + 1; i++) grid.push(`M${P(i, -1)} L${P(i, 13)}`);
  for (let j = -1; j <= 13; j++) grid.push(`M${P(-1, j)} L${P(W + 1, j)}`);
  const vault = centers[2]!;
  const partner = centers[1]!;
  const bank = centers[0]!;
  const approve = pt(W / 2, 9 + D / 2 - 0.85, 1);
  return (
    <svg className="sx-iso" viewBox="-372 -70 470 270" role="img" aria-labelledby="iso-title iso-desc">
      <title id="iso-title">The money path</title>
      <desc id="iso-desc">USDC leaves your own vault after you approve, reaches the payout partner, and the supplier&rsquo;s bank is paid in pesos.</desc>
      <path d={grid.join(' ')} className="iso-grid" />
      {SLABS.map((s) => (
        <SlabShape key={s.key} s={s} />
      ))}
      <polyline className="iso-route" points={[vault, partner, bank].map((p) => p.join(',')).join(' ')} />
      {[vault, partner, bank].map((p, n) => (
        <circle key={n} cx={p[0]} cy={p[1]} r={5} className="iso-node" />
      ))}
      <circle cx={approve[0]} cy={approve[1]} r={6} className="iso-approve" />
      <text x={approve[0] + 4} y={approve[1] + 22} className="iso-caption">
        You approve
      </text>
      {SLABS.map((s) => {
        const [x, y] = pt(0, s.j0 + D, s.h);
        return (
          <g key={s.key}>
            <text x={x - 12} y={y - 4} textAnchor="end" className="iso-label">
              {s.label}
            </text>
            <text x={x - 12} y={y + 11} textAnchor="end" className="iso-caption">
              {s.caption}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
