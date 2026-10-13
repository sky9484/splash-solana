// iso-ui
import clsx from 'clsx';

/**
 * The single "Test mode" marker (gold, ink text, a small ledge): once in the top row, and inline on
 * the specific thing that is a mock (the payout partner, a test top-up, the Investments account).
 * It replaces the full-width "Simulated" banner.
 */
export function TestModeBadge({ inline = false, label = 'Test mode', className }: { inline?: boolean; label?: string; className?: string }) {
  return <span className={clsx('iso-testmode', inline && 'iso-testmode--inline', className)}>{label}</span>;
}
