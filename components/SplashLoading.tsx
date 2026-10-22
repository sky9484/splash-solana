import Image from 'next/image';
import { Check } from 'lucide-react';

export type LoadingStep = { label: string; done: boolean };

/** The page's ground under the card: Paper by default, Pale on the sign-in pages. */
const GROUND = { paper: 'sl sp-page sp-ground-paper', pale: 'sl sp-page sp-ground-pale' } as const;

/**
 * "Loading your dashboard" (prompt 12 §3.2, preview tab 2; Sky, 18 Oct: this is the loader to rebuild).
 * A white card on the page's ground: the droplet mark bobbing with the US dollar token, the wordmark,
 * the steps the caller actually knows, and a three-dot pulse. No percentage and no made-up progress: a
 * step shows a tick only when the caller has seen it finish, and with nothing to report there is one
 * line, "Opening your desk". It appears only after 300 ms (styles/auth-p12.css), so a quick load never
 * flashes it; with reduced motion nothing bobs or pulses.
 */
export default function SplashLoading({ steps, ground = 'paper' }: { steps?: LoadingStep[]; ground?: 'paper' | 'pale' }) {
  const lines = steps && steps.length > 0 ? steps : [{ label: 'Opening your desk', done: false }];
  return (
    <div className={GROUND[ground]} role="status" aria-live="polite">
      <div className="sl-card">
        <div className="sl-mark" aria-hidden="true">
          <Image src="/cinematic/brand-mark.png" alt="" width={1024} height={1024} sizes="104px" className="sl-drop" loading="eager" />
          <Image src="/cinematic/token-usd.png" alt="" width={1024} height={1024} sizes="34px" className="sl-token" loading="eager" />
        </div>
        <span className="sl-wordmark">
          <Image src="/splash-main-icon.png" alt="" width={48} height={47} />
          Splash
        </span>
        <ul className="sl-steps">
          {lines.map((step) => (
            <li key={step.label} className={step.done ? 'is-done' : undefined}>
              {step.done ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}
              {step.label}
            </li>
          ))}
        </ul>
        <span className="sl-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
    </div>
  );
}
