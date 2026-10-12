import type { ReactNode } from 'react';

/**
 * Small pieces the admin console's Solana sections share. Server components; formatting is integer
 * arithmetic on bigint (lamports, MIST, minor units), never a float.
 */

/** Lamports → "1.9842 SOL" (four places, rounded half-up). */
export function sol(lamports: bigint | null): string {
  if (lamports === null) return 'Not read';
  const neg = lamports < 0n;
  const abs = neg ? -lamports : lamports;
  const tenThousandths = (abs + 50_000n) / 100_000n; // 10^9 lamports per SOL → 4 places
  const whole = tenThousandths / 10_000n;
  const frac = (tenThousandths % 10_000n).toString().padStart(4, '0');
  return `${neg ? '−' : ''}${whole.toLocaleString('en-US')}.${frac} SOL`;
}

/** Lamports, grouped: "2,039,280 lamports". */
export function lamports(n: bigint): string {
  return `${n.toLocaleString('en-US')} lamports`;
}

/** The evidence sponsor's gas, in MIST (the evidence network's smallest unit), grouped. */
export function mist(n: bigint | null): string {
  if (n === null) return 'Not read';
  return `${n.toLocaleString('en-US')} MIST`;
}

export function when(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function short(s: string, n = 6): string {
  return s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
}

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <header className="dash-surface p-6 md:p-8">
      <span className="dash-kicker">{kicker}</span>
      <h1 className="dash-title mt-2 text-3xl md:text-4xl">{title}</h1>
      {children ? <div className="mt-3 max-w-3xl text-sm leading-6 text-[#326273]">{children}</div> : null}
    </header>
  );
}

const TONE = {
  ok: 'bg-[var(--ok-bg)] text-[var(--ok)]',
  warn: 'bg-[var(--warn-bg)] text-[#8A4F08]',
  error: 'bg-[var(--error-bg)] text-[var(--error)]',
  info: 'bg-[var(--info-bg)] text-[var(--info)]',
  muted: 'bg-[var(--pending-bg)] text-[#4A5A62]',
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return <span className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${TONE[tone]}`}>{children}</span>;
}

/** An address or signature, shortened, with its Solscan page when it is on a network. */
export function Addr({ value, href, label }: { value: string; href?: string | null; label?: string }) {
  const text = <span className="font-mono text-[13px]" title={value}>{short(value)}</span>;
  if (!href) return text;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-[#326273]/40 underline-offset-2 hover:decoration-[#326273]">
      {text}
      <span className="sr-only"> {label ?? 'on Solscan'} (opens in a new tab)</span>
    </a>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'error' }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === 'error' ? 'border-[var(--error)]/40 bg-[var(--error-bg)]' : 'border-[#326273]/10 bg-white'}`}>
      <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#326273]">{label}</div>
      <div className={`mt-1 text-2xl font-black tabular-nums ${tone === 'error' ? 'text-[var(--error)]' : 'text-[#1f4350]'}`}>{value}</div>
      {note ? <div className="mt-1 text-xs leading-5 text-[#326273]">{note}</div> : null}
    </div>
  );
}

/** A plain table with a caption a screen reader announces. Scrolls sideways inside itself on a phone. */
export function Table({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#326273]/10 bg-white">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[#326273]/10 text-[12px] uppercase tracking-[0.12em] text-[#326273]">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#326273]/10 text-[#1f4350]">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}

/** Offline the chain is a simulator: every page says so once, at the top. */
export function SimulatedNote({ simulated }: { simulated: boolean }) {
  if (!simulated) return null;
  return (
    <p className="rounded-xl border border-[var(--info)]/20 bg-[var(--info-bg)] px-4 py-3 text-sm text-[var(--info)]">
      <strong>Simulated · devnet-ready.</strong> This server runs the offline simulator: signatures are simulated and have no Solscan page, and the fee payer&rsquo;s SOL is a simulated balance.
    </p>
  );
}
