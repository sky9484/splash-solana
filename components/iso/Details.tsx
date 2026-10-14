// iso-ui
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

/**
 * The disclosure that holds the allowed crypto words: "How it moves" on a route, "Technical
 * details" on a receipt (§0.6). Native <details>, so it opens with the keyboard and without script.
 */
export function Details({ summary, children, defaultOpen }: { summary: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="iso-details" open={defaultOpen}>
      <summary>
        <Info size={16} aria-hidden="true" />
        {summary}
      </summary>
      <div className="iso-details__body">{children}</div>
    </details>
  );
}
