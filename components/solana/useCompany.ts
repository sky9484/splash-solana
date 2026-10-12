'use client';

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from './client';
import type { CompanyDTO } from './types';

export type CompanyState =
  | { status: 'loading' }
  /** The session ended: the page should send the person to sign in. */
  | { status: 'signin'; message: string }
  /** Signed in, but not a member of a company yet. */
  | { status: 'no_company'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; company: CompanyDTO };

const CHANGED = 'splash-company-changed';

/** Every useCompany() on the page reloads (balance, forms, the payments list). */
export function notifyCompanyChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

/** The signed-in member's company, from the session (GET /api/solana/company). */
export function useCompany() {
  const [state, setState] = useState<CompanyState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', company: await api<CompanyDTO>('/company') });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ status: 'signin', message: e.message });
      else if (e instanceof ApiError && e.code === 'no_membership') setState({ status: 'no_company', message: e.message });
      else setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    // The company is read after mount: it depends on the session cookie and the server's state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const onChange = () => void load();
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [load]);

  return { state, reload: load };
}
