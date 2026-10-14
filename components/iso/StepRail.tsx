// iso-ui
import Link from 'next/link';
import { Check } from 'lucide-react';

export interface RailStep {
  label: string;
  /** A past step links back to itself. */
  href?: string;
}

/**
 * Five segments with a 3 px top rule (§2.3 StepRail): past steps teal with a tick (and a link
 * back), the current step paper with a ledge, future steps grey.
 */
export function StepRail({ steps, current, label = 'Steps' }: { steps: RailStep[]; current: number; label?: string }) {
  return (
    <ol className="iso-steprail" aria-label={label}>
      {steps.map((s, i) => {
        if (i < current) {
          const body = (
            <>
              <Check size={15} strokeWidth={3} aria-hidden="true" />
              <span>
                {s.label}
                <span className="iso-sr"> (done)</span>
              </span>
            </>
          );
          return (
            <li key={s.label} className="iso-steprail__item">
              {s.href ? (
                <Link href={s.href} className="iso-steprail__step iso-steprail__step--past">
                  {body}
                </Link>
              ) : (
                <span className="iso-steprail__step iso-steprail__step--past">{body}</span>
              )}
            </li>
          );
        }
        return (
          <li key={s.label} className="iso-steprail__item" aria-current={i === current ? 'step' : undefined}>
            <span className={i === current ? 'iso-steprail__step iso-steprail__step--now' : 'iso-steprail__step'}>
              {i + 1} · {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
