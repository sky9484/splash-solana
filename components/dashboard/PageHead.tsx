// iso-ui
'use client';

import type { ReactNode } from 'react';

import { RateStrip } from './ShellTopRow';
import { useNavShell } from './useNavShell';

/**
 * A redesigned page's title (prompt 10 §3.4): 34 px / 800, one line of context, actions on the right.
 * No eyebrow above it. On a phone the rate strip sits under the title (the top row drops it there).
 */
export function PageHead({ title, context, actions }: { title: ReactNode; context?: ReactNode; actions?: ReactNode }) {
  const shell = useNavShell();
  return (
    <header className="iso-pagehead iso-rise">
      <div>
        <h1 className="iso-title">{title}</h1>
        {context ? <p className="iso-context">{context}</p> : null}
        <RateStrip rate={shell?.rate ?? null} className="iso-phone-only" />
      </div>
      {actions ? <div className="iso-actions">{actions}</div> : null}
    </header>
  );
}
