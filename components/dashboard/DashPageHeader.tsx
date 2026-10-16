// iso-ui
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type DashPageHeaderProps = {
  /** Kept for callers; no longer shown. The header bar above every page names where you are (Sky, 16 Oct). */
  kicker?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * The title of a dashboard page that isn't a rebuilt look-9 screen (History, Batch payout, a receipt,
 * Rules, Recipients, Profile): the same title, line of context and actions as PageHead, so every page
 * starts the same way under the header bar.
 */
export default function DashPageHeader({ title, description, actions, className }: DashPageHeaderProps) {
  return (
    <header className={cn('iso iso-pagehead iso-rise', className)}>
      <div>
        <h1 className="iso-title">{title}</h1>
        {description ? <p className="iso-context">{description}</p> : null}
      </div>
      {actions ? <div className="iso-actions">{actions}</div> : null}
    </header>
  );
}
