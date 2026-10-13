// iso-ui
import type { ReactNode } from 'react';

/**
 * The sticky bottom bar on Transfer: ink, the total on the left, Back and the main action on the
 * right. The floating Zeke sits above it.
 */
export function ActionBar({ summary, children, label = 'This payment' }: { summary: ReactNode; children: ReactNode; label?: string }) {
  return (
    <div className="iso-actionbar" role="region" aria-label={label}>
      <div className="iso-actionbar__in">
        <p className="iso-actionbar__sum" style={{ margin: 0 }}>
          {summary}
        </p>
        <div className="iso-actions">{children}</div>
      </div>
    </div>
  );
}
