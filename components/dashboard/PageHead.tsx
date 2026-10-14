// iso-ui
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { RateStrip } from './ShellTopRow';
import { useNavShell } from './useNavShell';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * A redesigned page's title (prompt 10 §3.4): 34 px / 800, one line of context, actions on the right.
 * No eyebrow above it. A sub-page names where it sits ("Invoices / Pay an invoice") in `crumbs`, the
 * last one being the page itself. On a phone the rate strip sits under the title (the top row drops it
 * there).
 */
export function PageHead({ title, context, actions, crumbs }: { title: ReactNode; context?: ReactNode; actions?: ReactNode; crumbs?: Crumb[] }) {
  const shell = useNavShell();
  return (
    <header className="iso-pagehead iso-rise">
      <div>
        {crumbs && crumbs.length > 0 ? (
          <nav aria-label="Breadcrumb">
            <ol className="iso-crumbs">
              {crumbs.map((c, i) => (
                <li key={`${c.label}-${i}`}>
                  {c.href && i < crumbs.length - 1 ? <Link href={c.href}>{c.label}</Link> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className="iso-title">{title}</h1>
        {context ? <p className="iso-context">{context}</p> : null}
        <RateStrip rate={shell?.rate ?? null} className="iso-phone-only" />
      </div>
      {actions ? <div className="iso-actions">{actions}</div> : null}
    </header>
  );
}
