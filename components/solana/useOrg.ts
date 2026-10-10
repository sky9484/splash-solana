'use client';

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, rememberedOrgId, rememberOrgId } from './client';
import type { OrgDTO } from './types';

export type OrgState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'reset'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; org: OrgDTO };

/** The remembered demo company, loaded from the server. `reset` means the server restarted. */
export function useOrg() {
  const [state, setState] = useState<OrgState>({ status: 'loading' });

  const load = useCallback(async () => {
    const id = rememberedOrgId();
    if (!id) {
      setState({ status: 'none' });
      return;
    }
    try {
      const org = await api<OrgDTO>(`/orgs/${id}`);
      setState({ status: 'ready', org });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        rememberOrgId(null);
        setState({ status: 'reset', message: e.message });
      } else {
        setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }
  }, []);

  useEffect(() => {
    // Loading from localStorage and the server must happen after mount (no SSR access to either).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const onChange = () => void load();
    window.addEventListener('splash-org-changed', onChange);
    return () => window.removeEventListener('splash-org-changed', onChange);
  }, [load]);

  return { state, reload: load };
}
