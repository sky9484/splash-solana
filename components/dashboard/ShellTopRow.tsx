// iso-ui
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { TestModeBadge } from '@/components/iso';
import { locationFor } from '@/lib/dashboard/nav';

import { ShellSearch } from './ShellSearch';
import type { NavShellData } from './useNavShell';

const ROLE_LABEL: Record<string, string> = { admin: 'Finance admin', checker: 'Approver', maker: 'Prepares payments', viewer: 'Viewer' };

/** "Aisyah Rahman" → "AR". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '·';
}

/** The rate strip (§4.2): the partner's USD → PHP rate, as text (no next corridors, prompt 12 B8). */
export function RateStrip({ rate, className }: { rate: NavShellData['rate'] | null; className?: string }) {
  if (!rate) return null;
  return (
    <p className={`iso-ratestrip${className ? ` ${className}` : ''}`}>
      <strong>
        {rate.pair} {rate.rate}
      </strong>
      <span>{rate.label}</span>
    </p>
  );
}

/**
 * The header on every dashboard page (Sky, 16 Oct): one bar that stays at the top while the page
 * scrolls. Where you are on the left ("Money › Balance"), search in the middle, then the rate, the one
 * Test mode badge and the profile. On a phone the shell's own bar is the header, so this row only
 * wraps under it, and the rate strip moves under the page title (PageHead renders it there).
 */
export function ShellTopRow({ data, person, role, company, testMode }: { data: NavShellData | null; person: string; role?: string; company: string; testMode: boolean }) {
  const where = locationFor(usePathname() ?? '/dashboard');
  return (
    <div className="iso iso-toprow">
      <p className="iso-toprow__where iso-desktop-only">
        {where.group ? (
          <>
            <span>{where.group}</span>
            <span aria-hidden="true" className="iso-toprow__sep">
              ›
            </span>
          </>
        ) : null}
        <strong>{where.label}</strong>
      </p>
      <ShellSearch />
      <RateStrip rate={data?.rate ?? null} className="iso-desktop-only" />
      {testMode ? <TestModeBadge /> : null}
      <Link href="/dashboard/profile" className="iso-profile">
        <span className="iso-sr">Your profile: </span>
        <span className="iso-profile__initials" aria-hidden="true">
          {initials(person)}
        </span>
        <span className="iso-profile__text">
          <strong>{person}</strong>
          <span>
            {/* The company's own name and the owner's role, from the server's read once it answers. */}
            {data?.me?.isOwner ? 'Owner' : (ROLE_LABEL[role ?? ''] ?? 'Member')} · {data?.me?.companyName ?? company}
          </span>
        </span>
      </Link>
    </div>
  );
}
