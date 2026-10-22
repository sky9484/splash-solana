// iso-ui
'use client';

import Link from 'next/link';

import { TestModeBadge } from '@/components/iso';

import { ShellSearch } from './ShellSearch';
import type { NavShellData } from './useNavShell';

const ROLE_LABEL: Record<string, string> = { admin: 'Finance admin', checker: 'Approver', maker: 'Prepares payments', viewer: 'Viewer' };

/** "Aisyah Rahman" → "AR". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '·';
}

/** The rate strip (§4.2): the partner's USD → PHP rate and the next corridors, as text. */
export function RateStrip({ rate, className }: { rate: NavShellData['rate'] | null; className?: string }) {
  if (!rate) return null;
  return (
    <p className={`iso-ratestrip${className ? ` ${className}` : ''}`}>
      <strong>
        {rate.pair} {rate.rate}
      </strong>
      <span>{rate.label}</span>
      {rate.next.map((n) => (
        <span key={n}>· {n} next corridor</span>
      ))}
    </p>
  );
}

/**
 * The top row inside the content area (prompt 10 §3.3), not a header bar: search, the rate strip,
 * the one Test mode badge and the profile chip. On a phone it wraps, and the rate strip moves under
 * the page title (PageHead renders it there).
 */
export function ShellTopRow({ data, person, role, company, testMode }: { data: NavShellData | null; person: string; role?: string; company: string; testMode: boolean }) {
  return (
    <div className="iso iso-toprow">
      <ShellSearch />
      <RateStrip rate={data?.rate ?? null} className="iso-desktop-only" />
      {testMode ? <TestModeBadge /> : null}
      <Link href="/dashboard/profile" className="iso-profile" aria-label={`Your profile: ${person}, ${ROLE_LABEL[role ?? ''] ?? 'Member'} at ${company}`}>
        <span className="iso-profile__initials" aria-hidden="true">
          {initials(person)}
        </span>
        <span className="iso-profile__text">
          <strong>{person}</strong>
          <span>
            {ROLE_LABEL[role ?? ''] ?? 'Member'} · {company}
          </span>
        </span>
      </Link>
    </div>
  );
}
