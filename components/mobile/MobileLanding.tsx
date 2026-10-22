import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  FileCheck2,
  Gauge,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import WaitlistCta from '@/components/landing/WaitlistCta';
import { claims } from '@/content/claims';
import { BRAND } from '@/content/brand';

/**
 * Phone-only landing. Server component — zero client JS beyond Next's
 * runtime: no scroll-jacked cinematic, no multi-megabyte hero art, CSS-only
 * motion. The desktop/iPad experience stays on IsometricLanding; this is a
 * single-column, thumb-first retelling of the same story.
 */

const proofChips = [
  "You don't need SOL",
  'USDC on Solana',
  'A person approves',
];

const marqueeItems = [
  ['1 sandbox corridor', 'MY to PH'],
  ['USDC', 'settled on Solana'],
  ["You don't need SOL", 'network fees covered'],
  ['0.70%', 'to local currency'],
  ['A person approves', 'Zeke drafts'],
  ['Stored proof', 'A record that lasts'],
];

// The four steps, as approved for the Solana build.
const steps = [
  { number: '01', title: 'Your vault', copy: "Money sits in your business's own Squads vault. No Splash key can move it." },
  { number: '02', title: 'Best route', copy: 'Routes are ranked by the pesos the supplier receives, with the fee shown before anything is signed.' },
  { number: '03', title: 'A person approves', copy: "Zeke drafts. A person approves with their device key. A payout partner pays the supplier's bank." },
  { number: '04', title: 'Proof saved', copy: 'Receipts and evidence are encrypted, stored, and anchored on Solana for the auditor.' },
];

const compareRows = [
  { label: 'Network fees', bank: 'Wire charges', splash: "You don't need SOL" },
  { label: 'Fee to local currency', bank: '3–5%', splash: '0.70%' },
  { label: 'Audit trail', bank: 'Siloed records', splash: 'One record, both sides' },
];

const trustPoints = [
  { icon: Gauge, title: 'Your vault, your keys', copy: "Money stays in your business's own vault. Splash never holds it, and no Splash key can move it." },
  { icon: ShieldCheck, title: 'You stay in control', copy: 'Zeke drafts. It cannot sign or send. Every payout needs a person to approve it.' },
  { icon: FileCheck2, title: 'Proof that lasts', copy: 'Encrypted receipts, written where they cannot be quietly changed.' },
];

// No logo stands in for the settlement network: there is no approved Solana
// mark in public/ yet.
const partners = [
  { src: '/stripe-logo.svg', name: 'Stripe' },
  { src: '/partners/pyth.png', name: 'Pyth' },
  { src: '/sumsub-logo.png', name: 'Sumsub' },
];

export default function MobileLanding() {
  return (
    <main className="mob-landing">
      {/* ── Sticky header ─────────────────────────────────── */}
      <header className="mob-header">
        <Link href="/" className="mob-brand" aria-label="Splash Finance home">
          <Image src="/splash-main-icon.png" alt="" width={64} height={63} priority />
          <strong>Splash</strong>
        </Link>
        <Link href="/signup" className="mob-btn mob-btn-small">
          Start sending
        </Link>
      </header>

      {/* ── Hero ──────────────────────────────────────────── */}
      <section className="mob-hero" aria-labelledby="mob-hero-title">
        <p className="mob-kicker">
          <span className="mob-kicker-dot" aria-hidden="true" />
          MY → PH corridor · sandbox
        </p>
        <h1 id="mob-hero-title" className="mob-display">
          Pay suppliers abroad.
          <span>Prove every payment.</span>
        </h1>
        <p className="mob-hero-copy">
          Malaysian businesses pay suppliers in the Philippines in USDC on Solana.
          Delivered to their bank. Proof for the auditor. We never hold the money.
        </p>
        <div className="mob-hero-actions">
          <Link href="/signup" className="mob-btn mob-btn-primary">
            Start sending
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link href="/login" className="mob-btn mob-btn-ghost">Log in</Link>
        </div>
        <ul className="mob-proof-chips" aria-label="Platform highlights">
          {proofChips.map((chip) => (
            <li key={chip}>
              <BadgeCheck aria-hidden="true" />
              {chip}
            </li>
          ))}
        </ul>
        <div className="mob-hero-art" aria-hidden="true">
          <Image
            src="/cinematic/agent-bot-cut.png"
            alt=""
            width={480}
            height={480}
            sizes="(max-width: 480px) 70vw, 340px"
            priority
          />
        </div>
      </section>

      {/* ── Metrics ticker ────────────────────────────────── */}
      <div className="mob-marquee" aria-label="Platform metrics">
        <div className="mob-marquee-track">
          {[...marqueeItems, ...marqueeItems].map(([value, label], index) => (
            <span className="mob-marquee-item" key={`${value}-${index}`}>
              <strong>{value}</strong> {label} <i aria-hidden="true">◆</i>
            </span>
          ))}
        </div>
      </div>

      {/* ── How it works ──────────────────────────────────── */}
      <section className="mob-section" aria-labelledby="mob-how-title">
        <p className="mob-eyebrow">How it works</p>
        <h2 id="mob-how-title" className="mob-title">
          Four steps.
          <span>No limbo.</span>
        </h2>
        <ol className="mob-steps">
          {steps.map((step) => (
            <li key={step.number} className="mob-step">
              <span className="mob-step-number" aria-hidden="true">{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Compare ───────────────────────────────────────── */}
      <section className="mob-section mob-section-dark" aria-labelledby="mob-compare-title">
        <p className="mob-eyebrow">Compare</p>
        <h2 id="mob-compare-title" className="mob-title mob-title-light">
          Built for business.
          <span>Designed to move.</span>
        </h2>
        <div className="mob-compare">
          <div className="mob-compare-head" aria-hidden="true">
            <span>Typical bank</span>
            <span className="is-splash">Splash</span>
          </div>
          {compareRows.map((row) => (
            <div className="mob-compare-row" key={row.label}>
              <span className="mob-compare-label">{row.label}</span>
              <span className="mob-compare-bank">{row.bank}</span>
              <span className="mob-compare-splash">
                <BadgeCheck aria-hidden="true" />
                {row.splash}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Trust ─────────────────────────────────────────── */}
      <section className="mob-section" aria-labelledby="mob-trust-title">
        <p className="mob-eyebrow">Trust</p>
        <h2 id="mob-trust-title" className="mob-title">
          Safe by
          <span>design.</span>
        </h2>
        <div className="mob-trust-list">
          {trustPoints.map(({ icon: Icon, title, copy }) => (
            <article className="mob-trust-card" key={title}>
              <span className="mob-trust-icon"><Icon aria-hidden="true" /></span>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Partners ──────────────────────────────────────── */}
      <section className="mob-section mob-partners" aria-label="Infrastructure partners">
        <p className="mob-eyebrow">Infrastructure &amp; partners</p>
        <div className="mob-partner-row">
          {partners.map((partner) => (
            <span key={partner.name} className="mob-partner">
              <Image src={partner.src} alt={`${partner.name} logo`} width={96} height={48} />
            </span>
          ))}
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────── */}
      <section className="mob-section mob-final" aria-labelledby="mob-final-title">
        <Sparkles className="mob-final-spark" aria-hidden="true" />
        <h2 id="mob-final-title" className="mob-title mob-title-light">
          Your treasury,
          <span>finally programmable.</span>
        </h2>
        <p className="mob-final-copy">
          Start with USDC. Prove the MY-to-PH path. Expand when controls are ready.
        </p>
        <Link href="/signup" className="mob-btn mob-btn-gold">
          Open the payment desk
          <ArrowRight aria-hidden="true" />
        </Link>
        <div className="mob-waitlist-slot">
          <WaitlistCta variant="mob" />
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer className="mob-footer">
        <div className="mob-footer-brand">
          <Image src="/splash-main-icon.png" alt="" width={48} height={47} />
          <strong>Splash</strong>
        </div>
        <nav className="mob-footer-nav" aria-label="Footer">
          <Link href="/login">Log in</Link>
          <Link href="/signup">Create account</Link>
          <Link href="/trust">Trust &amp; compliance</Link>
          <Link href="/working-capital">Working capital</Link>
        </nav>
        <small>{claims.footerLegal.claim}</small>
        <small>{BRAND.copyright()}</small>
      </footer>
    </main>
  );
}
