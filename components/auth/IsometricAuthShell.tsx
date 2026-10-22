import Image from 'next/image';
import Link from 'next/link';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The one shell for sign in, sign up, forgot and reset password and verify email (prompt 12 §3.1,
 * preview tab 2): a Pale page and one white card, the art panel on the left (on a phone, on top) and
 * the form on cream on the right. Each page has its own picture, shared with nothing on the landing or
 * the dashboard (decision 15; D3: reset reuses forgot's, verify reuses sign up's). The picture fades up
 * when the page changes. Styles: styles/auth-p12.css.
 */
const ART = {
  // Decision 5: the night desk. Opaque, so the panel takes its colour and a mask hides the edge.
  signin: { src: '/isometric/gen/auth-signin-night.webp', width: 1200, height: 900, night: true },
  signup: { src: '/isometric/gen/auth-signup-new-desk.webp', width: 800, height: 608, night: false },
  recovery: { src: '/isometric/gen/auth-forgot-mailbox.webp', width: 800, height: 716, night: false },
} as const;

/* No chain names on the sign-in screens: the business doesn't need to know
   which network settles, only what it gets. */
const proofPoints = ['Your vault, your keys', 'A person approves every payment', 'One record per payment'];

type IsometricAuthShellProps = {
  children: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  art: keyof typeof ART;
  visualTitle: string;
  visualCopy: string;
};

export default function IsometricAuthShell({ children, eyebrow, title, description, art, visualTitle, visualCopy }: IsometricAuthShellProps) {
  const picture = ART[art];
  return (
    <main className="au sp-page sp-ground-pale">
      <div className="au-top">
        <Link href="/" className="au-back">Back to Splash</Link>
      </div>

      <section className="au-card">
        <aside className={`au-art${picture.night ? ' au-art--night' : ''}`}>
          <div className="au-art__brand">
            <span className="au-wordmark">
              <span className="au-wordmark__icon">
                <Image src="/splash-main-icon.png" alt="" width={48} height={47} />
              </span>
              Splash
            </span>
            <p>Pay suppliers abroad. Prove every payment.</p>
          </div>
          <div className="au-art__picture">
            <Image src={picture.src} alt="" width={picture.width} height={picture.height} sizes="(max-width: 1000px) 80vw, 480px" loading="eager" />
          </div>
          <div className="au-art__lead">
            <p className="au-kick au-kick--light">{visualTitle}</p>
            <p className="au-art__line">{visualCopy}</p>
            <ul className="au-points">
              {proofPoints.map((point) => (
                <li key={point}><Check aria-hidden="true" />{point}</li>
              ))}
            </ul>
          </div>
        </aside>

        <section className="au-form-panel">
          <p className="au-kick">{eyebrow}</p>
          <h1 className="au-title">{title}</h1>
          <p className="au-sub">{description}</p>
          {children}
        </section>
      </section>
    </main>
  );
}
