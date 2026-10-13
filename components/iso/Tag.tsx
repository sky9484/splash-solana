// iso-ui
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import clsx from 'clsx';

export type TagTone = 'coral' | 'amber' | 'ok' | 'ink' | 'gold' | 'danger';

/**
 * A square status chip. Coral is "Approve" only, amber "Verify" and other warnings, ok "Paid · proof
 * recorded" and "Verified", ink "Next" and neutral states, gold Treasury and test money, danger a failure.
 */
export function Tag({ tone = 'ink', tick = false, className, children }: { tone?: TagTone; tick?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={clsx('iso-tag', `iso-tag--${tone}`, className)}>
      {tick ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
