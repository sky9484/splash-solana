'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import type { NavCounts } from '@/lib/dashboard/nav';

/** What GET /api/solana/nav answers: the badges' counts and the rate strip. */
export interface NavShellData {
  counts: NavCounts;
  rate: { pair: string; rate: string; label: string; next: string[] };
  /** Who is asking: the company's own name and whether this member is its owner (the profile chip). */
  me?: { companyName: string; isOwner: boolean };
}

const CHANGED = 'splash-company-changed';

/**
 * The shell's one read of the server's counts (prompt 10 §3.1): on load, on every page change, when
 * the company changes (a payment approved, a bill checked) and when the tab comes back into view.
 * Null until it answers (or with no company yet): no badge is ever guessed.
 */
export function useNavShellData(): NavShellData | null {
  const pathname = usePathname();
  const [data, setData] = useState<NavShellData | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/solana/nav', { cache: 'no-store' });
      if (!res.ok) return;
      setData((await res.json()) as NavShellData);
    } catch {
      /* the badges wait for the next read */
    }
  }, []);

  useEffect(() => {
    // The counts are read after mount and on every page change: they depend on the session and
    // the server's state. The state is set when the read answers, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, pathname]);

  useEffect(() => {
    const onChange = () => void load();
    const onVisible = () => document.visibilityState === 'visible' && void load();
    window.addEventListener(CHANGED, onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(CHANGED, onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return data;
}

/** The shell's data, for the parts of a page that show it (the rate strip under a title on a phone). */
export const NavShellContext = createContext<NavShellData | null>(null);

export function useNavShell(): NavShellData | null {
  return useContext(NavShellContext);
}
