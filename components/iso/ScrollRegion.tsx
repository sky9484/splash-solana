// iso-ui
import type { ReactNode } from 'react';

/**
 * A wide table (or anything else) that scrolls sideways on a phone. It is a labelled, focusable
 * region, so the keyboard can scroll it as well as a finger.
 */
export function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="iso-table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
