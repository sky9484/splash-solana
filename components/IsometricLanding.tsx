'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Anchor, ArrowRight, ArrowUp, Check, ChevronRight, PenLine, ShieldCheck, Workflow, Zap } from 'lucide-react';

import HeroStory from '@/components/landing/HeroStory';
import HeroStoryPhone from '@/components/landing/HeroStoryPhone';
import ControlPlaneExplainer from '@/components/oxwal/ControlPlaneExplainer';
import { claims, corridors, lockedCopy } from '@/content/claims';
import { BRAND } from '@/content/brand';

/* Prompt 12 §2 (preview tab 1). Styles: styles/landing-p12.css, --sp-* tokens only. The extruded
   display type is the landing's own .iso-display (app/globals.css), unchanged (decision 14). */

/** A two-letter or currency code pair. The arrow is data, read as "to", not a button. */
function Codes({ from, to }: { from: string; to: string }) {
  return (
    <span className="lp-codes">
      {from}
      <ArrowRight size={14} role="img" aria-label="to" />
      {to}
    </span>
  );
}

type Foot = string | { from: string; to: string };

function Tags({ items, className = 'lp-tags' }: { items: Foot[]; className?: string }) {
  return (
    <span className={className}>
      {items.map((item) => (
        <span className="lp-tag" key={typeof item === 'string' ? item : `${item.from}-${item.to}`}>
          {typeof item === 'string' ? item : <Codes from={item.from} to={item.to} />}
        </span>
      ))}
    </span>
  );
}

function Kicker({ children, sub, number }: { children: string; sub?: string; number?: string }) {
  return (
    <p className="lp-kick">
      {number ? <span className="lp-num">{number}</span> : null}
      {children}
      {sub ? <span className="lp-kick__sub">{sub}</span> : null}
    </p>
  );
}

const loopCards = [
  {
    number: '01',
    label: 'Settle',
    live: true,
    title: 'Pay the supplier’s bank.',
    copy: 'Pay suppliers in the Philippines in USDC on Solana. Every approved payout builds verified counterparties and settlement history.',
    image: '/isometric/loop-settle-v4.png',
    width: 1448,
    height: 1086,
    foot: [{ from: 'USDC', to: 'PHP' }, 'Sandbox'] as Foot[],
  },
  {
    number: '02',
    label: 'Keep',
    live: true,
    title: 'Keep it in your vault.',
    copy: 'Money waits in your business’s own Squads vault. No Splash key can move it, and a person approves every payment out.',
    // D1: the preview's loop-save art is banned (it shows idle dollars rising at a variable rate).
    image: '/cinematic/treasury-island.png',
    width: 2752,
    height: 1536,
    foot: ['Your vault', 'Human-approved'] as Foot[],
  },
  {
    number: '03',
    label: 'Supply',
    live: false,
    title: 'Finance it, later.',
    copy: 'Invoices would become working capital: your buyer funds early payment against a receivable both sides can verify.',
    image: '/isometric/loop-supply.png',
    width: 1200,
    height: 900,
    foot: ['Buyer-funded', 'No third-party lender'] as Foot[],
  },
];

// No payout partner is named here, and no logo stands in for the settlement
// network: there is no approved Solana mark in public/ yet.
const partnerRail: Array<{ src: string; name: string; role: string }> = [
  { src: '/stripe-logo.svg', name: 'Stripe', role: 'USD collection' },
  { src: '/partners/pyth.png', name: 'Pyth', role: 'FX and peg data' },
  { src: '/sumsub-logo.png', name: 'Sumsub', role: 'KYB and KYC' },
];

/** Partner badge: the logo at rest; hover or focus dims it and shows the name and role. A click
    balloon-pops the logo (the cin-balloon keyframes in styles/cinematic.css). */
function PartnerBadge({ src, name, role }: (typeof partnerRail)[number]) {
  const [popping, setPopping] = useState(false);
  return (
    <button type="button" className="lp-partner" onClick={() => setPopping(true)} aria-label={`${name}: ${role}`}>
      <span
        className={`lp-partner__logo${popping ? ' is-popping' : ''}`}
        onAnimationEnd={(event) => {
          if (event.animationName === 'cin-balloon') setPopping(false);
        }}
      >
        <Image src={src} alt={`${name} logo`} width={240} height={140} />
      </span>
      <span className="lp-partner__reveal" aria-hidden="true">
        <strong>{name}</strong>
        <small>{role}</small>
      </span>
    </button>
  );
}

/* How it works, in the four steps prompt 07 §6.1 names. Step 04's line is one of the two the copy
   rules let name the evidence layer (scripts/copy-rules.mjs SANCTIONED_TECH_LINES). Prompt 12 §2.5
   changes only the art and the step tags. */
const flowSteps = [
  {
    id: 'vault',
    number: '01',
    title: 'Your vault',
    description: 'Your company gets its own Squads vault on Solana. Its keys are made in your browser, and no Splash key can move the money.',
    image: '/isometric/gen/how-01-vault-keys.webp',
    width: 900,
    height: 927,
    stat: 'Squads, on Solana',
  },
  {
    id: 'route',
    number: '02',
    title: 'Best route by pesos received',
    description: 'Zeke reads the invoice and a person checks every field. Routes are ranked by the pesos your supplier receives, with every fee shown first.',
    image: '/isometric/gen/how-02-ranked-by-pesos.webp',
    width: 900,
    height: 902,
    stat: 'Both fees shown first',
  },
  {
    id: 'approve',
    number: '03',
    title: 'A person approves',
    description: "One approval on your device signs it. You don't need SOL. A payout partner then pays the supplier's bank in pesos.",
    image: '/isometric/gen/how-03-person-approves.webp',
    width: 900,
    height: 690,
    stat: 'Approve on this device',
  },
  {
    id: 'proof',
    number: '04',
    title: 'Proof saved',
    description: 'Proof saved: encrypted on Walrus, anchored on Solana',
    detail: 'One record per payment: the invoice, the approval, the transfer and the rate. Trace every transaction on Solscan.',
    image: '/isometric/gen/how-04-proof-saved.webp',
    width: 900,
    height: 677,
    stat: 'This receipt verifies',
  },
] as Array<{ id: string; number: string; title: string; description: string; detail?: string; image: string; width: number; height: number; stat: string }>;

const operatingLayers = [
  {
    number: '01',
    label: 'Vault',
    title: 'Your money stays yours.',
    copy: "Money sits in your business's own Squads vault. No Splash key can move it.",
    image: '/cinematic/liquidity-pools.png',
    width: 1200,
    height: 896,
    tags: ['Your vault', 'Your approval'],
  },
  {
    number: '02',
    label: 'Settlement',
    title: 'Transfer and fee, one transaction.',
    copy: "A payment's transfer and Splash's fee land together, or nothing moves. A batch goes in chunks, and each chunk pays all its suppliers or none.",
    image: '/cinematic/settlement-machine.png',
    width: 2752,
    height: 1536,
    tags: ['USDC on Solana', "You don't need SOL"],
  },
  {
    number: '03',
    label: 'Approval',
    title: 'Zeke drafts. A person approves.',
    copy: 'Zeke drafts payments and batches. It cannot sign or send. A person approves each payment with their device key.',
    // D2: an icon tile until Sky supplies the art.
    image: null,
    width: 0,
    height: 0,
    tags: ['Device key', 'Human approval'],
  },
];

const routeTiles = [
  { label: 'They receive', value: '₱287,000.00', more: 'The full invoice amount. The supplier never pays a landing fee.' },
  { label: 'You pay', value: 'US$5,012.50', more: 'US$5,000.00 converted, plus US$12.50 in fees, shown before you approve.' },
  { label: 'Rate', value: '57.40', more: 'Locked for 60 seconds from the quote. Test rate in the sandbox.' },
  { label: 'Paid out by', value: 'PESONet', more: 'Any Philippine bank. InstaPay for smaller amounts.' },
];

const comparisonRows = [
  { feature: 'Who holds the money', bank: 'The bank', broker: 'The broker', platform: 'The platform', splash: 'Your own vault' },
  { feature: 'Fee', bank: '3-5%', broker: '2-4%', platform: '0.5-1.5%', splash: lockedCopy.fee },
  { feature: 'Rate', bank: 'In the markup', broker: 'In the spread', platform: 'Mid-market + fee', splash: 'On the card first' },
  { feature: 'Supplier bank check', bank: 'None', broker: 'Varies', platform: 'Name check', splash: 'Call-back' },
  { feature: 'Approval', bank: 'Bank login', broker: 'Email or phone', platform: 'User login', splash: 'Approver’s device' },
  { feature: 'Batch', bank: 'Bank file', broker: 'Manual', platform: 'Batch tool', splash: 'One file, one approval' },
  { feature: 'Receipt', bank: 'Bank advice', broker: 'Email', platform: 'History export', splash: 'Verifies itself' },
  { feature: 'Idle cash', bank: 'Deposit', broker: null, platform: null, splash: 'Reserve, with a treasury option in test mode' },
];

/** A comparison cell: a dash where the column offers nothing, read out as such. */
function Cell({ value }: { value: string | null }) {
  if (value) return <>{value}</>;
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="lp-sr">Not offered</span>
    </>
  );
}

/* Trust · Four gates: the control sequence every payout passes, in order (D9: kept, restyled). Copy
   stays inside content/claims.ts truth: Sumsub KYB wired, human-final approval, settlement, and the
   encrypted evidence recorded beside it. */
const trustGates = [
  {
    number: '01',
    label: 'Verify',
    icon: ShieldCheck,
    title: 'Verified before money moves.',
    copy: "Your business is verified before any payout. A supplier's new bank details are confirmed by call-back before the first payment.",
    tags: ['KYB gate', 'Bank call-back'],
  },
  {
    number: '02',
    label: 'Approve',
    icon: PenLine,
    title: 'A person signs. Always.',
    copy: 'Zeke drafts. A person approves with their device key. No payout or batch executes without that approval.',
    tags: ['Maker-checker', 'Human-final'],
  },
  {
    number: '03',
    label: 'Settle',
    icon: Zap,
    title: 'Exactly as approved.',
    copy: "A payment's transfer and Splash's fee land in one Solana transaction, or nothing moves. A batch goes in chunks, and each chunk is all-or-none.",
    tags: ['Settled on Solana'],
  },
  {
    number: '04',
    label: 'Prove',
    icon: Anchor,
    title: 'Evidence outlives the payment.',
    copy: 'Each receipt is encrypted, kept, and anchored on Solana, so it cannot be quietly changed. Hand it to your auditor with a link.',
    tags: ['Encrypted and recorded'],
  },
];

const headerNavItems = [
  { href: '#how-it-works', label: 'How it works', detail: '4 steps' },
  { href: '#platform', label: 'Platform', detail: 'Vault + proof' },
  { href: '/working-capital', label: 'Working capital', detail: 'Supply loop' },
  { href: '#corridors', label: 'Routes', detail: 'MY-PH sandbox' },
  { href: '#comparison', label: 'Compare', detail: 'Fees + proof' },
  { href: '#copilot', label: 'Zeke', detail: 'Prepare + approve' },
];

export default function IsometricLanding({ isPhone = false }: { isPhone?: boolean }) {
  const [activeFlow, setActiveFlow] = useState(flowSteps[0]);
  // The control plane reveals below the Zeke strip on demand, not as a second section.
  const [ctrlOpen, setCtrlOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const backToTop = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function updateHeaderState() {
      setShowBackToTop(window.scrollY > Math.max(20, window.innerHeight * 0.05));
      // The button rises by as much as the footer's dark bar has come into the window, so it never sits on the
      // footer's sanctioned line (prompt 12 Phase 7; the footer itself stays as it is). Set on the element, not
      // in state: nothing else re-renders while the page scrolls.
      const bar = document.querySelector('.cin-footer-bar');
      const lift = bar ? Math.max(0, Math.round(window.innerHeight - bar.getBoundingClientRect().top)) : 0;
      if (backToTop.current) backToTop.current.style.bottom = lift ? `${24 + lift}px` : '';
    }

    updateHeaderState();
    window.addEventListener('scroll', updateHeaderState, { passive: true });
    window.addEventListener('resize', updateHeaderState);
    return () => {
      window.removeEventListener('scroll', updateHeaderState);
      window.removeEventListener('resize', updateHeaderState);
    };
  }, []);

  return (
    <main className={`iso-landing lp sp-page sp-ground-paper${isPhone ? ' is-phone' : ''}`}>
      <header className={`iso-header ${showBackToTop ? 'is-scrolled' : ''}`}>
        <div className="iso-shell iso-header-inner">
          <Link href="/" className="iso-brand" aria-label="Splash Finance home">
            <Image src="/splash-main-icon.png" alt="" width={841} height={823} className="iso-header-brand-icon" loading="eager" />
            <span className="iso-header-wordmark">
              <strong>Splash</strong>
            </span>
          </Link>

          <nav className="iso-nav" aria-label="Primary navigation">
            {headerNavItems.map((item) => (
              <a href={item.href} key={item.href}>
                <span>{item.label}</span>
                <small>{item.detail}</small>
              </a>
            ))}
          </nav>

          <div className="iso-header-actions">
            <span className="iso-header-status">
              <small>Sandbox</small>
              <strong>MY-PH sandbox</strong>
            </span>
            <Link href="/signup" className="lp-btn lp-btn--dark">Start sending</Link>
          </div>
        </div>
      </header>

      {/* The phone decision is the server's (app/page.tsx), so a phone gets its hero on the first byte.
          Everyone else gets both, and a width query shows the phone hero in a narrow window. */}
      {isPhone ? (
        <HeroStoryPhone serverPhone />
      ) : (
        <>
          <div className="lp-hero-desktop"><HeroStory /></div>
          <div className="lp-hero-phone"><HeroStoryPhone /></div>
        </>
      )}

      <section id="loops" className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head">
            <div>
              <Kicker>The three loops</Kicker>
              <h2 className="iso-display lp-display lp-display--section">
                Move it. Keep it.
                <span>Finance it.</span>
              </h2>
            </div>
            <p className="lp-lede">
              USDC on Solana already moves. Splash&apos;s job is what the transfer alone can&apos;t do: reach the
              supplier&apos;s bank, keep the money in your own vault, and turn invoices into working capital.
            </p>
          </div>

          <div className="lp-grid3">
            {loopCards.map((loop) => (
              <article className="lp-card lp-card--hover" key={loop.number}>
                <div className="lp-card__top">
                  <span className="lp-chips">
                    <span className="lp-num">{loop.number}</span>
                    <span className="lp-chip">{loop.label}</span>
                  </span>
                  {loop.live ? <span className="lp-tag lp-tag--ok lp-tag--live">Live</span> : <span className="lp-tag lp-tag--coral">Roadmap</span>}
                </div>
                <div className="lp-card__art">
                  <Image src={loop.image} alt="" width={loop.width} height={loop.height} sizes="(max-width: 1000px) 80vw, 320px" />
                </div>
                <h3 className="lp-card__title">{loop.title}</h3>
                <p className="lp-card__copy">{loop.copy}</p>
                <Tags items={loop.foot} />
                {loop.live ? null : (
                  <Link href="/working-capital" className="lp-link">How Supply would work</Link>
                )}
              </article>
            ))}
          </div>

          <div className="lp-loops-foot">
            <p>
              <strong>Where the fees live:</strong> Splash&apos;s fee payer covers the Solana network fees, so you
              don&apos;t need SOL. Splash charges 0.10% per payout (US$2 minimum); the payout partner&apos;s fee is
              shown before you approve.
            </p>
            <Link href="/working-capital" className="lp-btn lp-btn--dark">Explore the Supply loop</Link>
          </div>
        </div>
      </section>

      <section className="lp-partners" aria-label="Infrastructure partners">
        <div className="lp-wrap lp-partners__in">
          <div className="lp-partners__intro">
            <Kicker>Infrastructure and partners</Kicker>
            <p>Partners of record on the outside. Settlement and the record inside.</p>
          </div>
          <div className="lp-partners__grid">
            {partnerRail.map((partner) => (
              <PartnerBadge key={partner.name} {...partner} />
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="lp-sec lp-sec--flush">
        <div className="lp-wrap">
          <div className="lp-band lp-steps">
            <div>
              <Kicker>How it works</Kicker>
              <h2 className="iso-display lp-display lp-display--band">
                Four steps.
                <span>One record.</span>
              </h2>
              <div className="lp-stepbtns">
                {flowSteps.map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    className="lp-stepbtn"
                    aria-current={activeFlow.id === step.id ? 'step' : undefined}
                    aria-controls="how-panel"
                    onClick={() => setActiveFlow(step)}
                  >
                    <span className="lp-num">{step.number}</span>
                    {step.title}
                    <ChevronRight aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>

            <div className="lp-card lp-steps__panel" id="how-panel" aria-live="polite">
              <div className="lp-steps__stat">
                <span className="lp-tag lp-tag--gold">{activeFlow.stat}</span>
              </div>
              <div className="lp-steps__art">
                <Image
                  key={activeFlow.id}
                  src={activeFlow.image}
                  alt=""
                  width={activeFlow.width}
                  height={activeFlow.height}
                  sizes="(max-width: 1000px) 80vw, 440px"
                  className="lp-rise"
                />
              </div>
              <div className="lp-steps__caption">
                <span className="lp-num lp-num--gold">{activeFlow.number}</span>
                <div>
                  <strong>{activeFlow.title}</strong>
                  <p>{activeFlow.description}</p>
                  {activeFlow.detail ? <p>{activeFlow.detail}</p> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head">
            <div>
              <Kicker>The platform</Kicker>
              <h2 className="iso-display lp-display lp-display--section">
                Everything between invoice
                <span>and settlement.</span>
              </h2>
            </div>
            <p className="lp-lede">
              One approval-gated desk for your vault, your suppliers&apos; payouts and the proof. Everything runs in
              the sandbox until a payout partner is live.
            </p>
          </div>

          <div className="lp-grid3">
            {operatingLayers.map((layer) => (
              <article className="lp-card lp-card--hover" key={layer.number}>
                <div className="lp-card__top">
                  <span className="lp-num">{layer.number}</span>
                  <span className="lp-chip">{layer.label}</span>
                </div>
                <div className="lp-card__art">
                  {layer.image ? (
                    <Image src={layer.image} alt="" width={layer.width} height={layer.height} sizes="(max-width: 1000px) 80vw, 320px" />
                  ) : (
                    // When Sky adds the P3 art (platform-03-device-key, webp, under isometric/gen) this tile
                    // becomes an Image like the two beside it: a one-line swap.
                    <span className="lp-icon-tile"><ShieldCheck aria-hidden="true" /></span>
                  )}
                </div>
                <h3 className="lp-card__title">{layer.title}</h3>
                <p className="lp-card__copy">{layer.copy}</p>
                <Tags items={layer.tags} />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="corridors" className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-routes">
            <div>
              <Kicker sub="The first corridor">Routes</Kicker>
              <h2 className="iso-display lp-display lp-display--section">
                USDC in.
                <span>Pesos out.</span>
              </h2>
              <p className="lp-lede">
                Malaysia to the Philippines is the sandbox corridor. Indonesia follows when a payout partner and the
                controls are ready.
              </p>
              <span className="lp-tags lp-routes__tag"><span className="lp-tag lp-tag--ink">Philippines, in sandbox</span></span>
              <Link href="/signup" className="lp-btn lp-btn--dark">Open the payout desk</Link>
            </div>
            <Image
              src="/cinematic/corridor-bridge-v3.png"
              alt=""
              width={1376}
              height={768}
              sizes="(max-width: 1000px) 92vw, 620px"
              className="lp-routes__art lp-bob"
            />
          </div>

          <div className="lp-rtiles">
            {routeTiles.map((tile) => (
              <div className="lp-rtile" tabIndex={0} role="group" aria-label={tile.label} key={tile.label}>
                <span className="lp-rtile__label">{tile.label}</span>
                <span className="lp-rtile__value">{tile.value}</span>
                <span className="lp-rtile__more">{tile.more}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="region" className="lp-sec">
        <div className="lp-wrap lp-region">
          <div>
            <Kicker>Southeast Asia</Kicker>
            <h2 className="lp-h-clean">
              Built for the trade between <em>our neighbours.</em>
            </h2>
            <p className="lp-lede">
              Malaysian businesses buy from across the region. Splash starts where the volume is and adds a corridor
              only when a payout partner for that country is signed and the controls are ready.
            </p>
            <ul className="lp-corr">
              {corridors.map((c) => (
                <li className={`lp-corr__row${c.status === 'sandbox' ? ' is-now' : ''}`} key={`${c.from}-${c.to}`}>
                  <Codes from={c.from} to={c.to} />
                  <strong>{c.status === 'sandbox' ? 'Sandbox today' : 'Roadmap'}</strong>
                </li>
              ))}
            </ul>
          </div>
          <Image
            src="/isometric/gen/region-sea-map.webp"
            alt="Isometric map of Southeast Asian landmarks linked by payment routes"
            width={1400}
            height={950}
            sizes="(max-width: 860px) 92vw, 680px"
            className="lp-region__art"
          />
        </div>
      </section>

      <section id="comparison" className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head">
            <div>
              <Kicker>Comparison</Kicker>
              <h2 className="iso-display lp-display lp-display--section">
                Built for business.
                <span>Designed to move.</span>
              </h2>
            </div>
            <p className="lp-lede">
              Splash charges when a payout leaves for a supplier&apos;s bank, shows every fee before you approve, and
              keeps one record per payment.
            </p>
          </div>

          <div className="lp-cmp-wrap" role="region" aria-label="Comparison table" tabIndex={0}>
            <table className="lp-cmp">
              <thead>
                <tr>
                  <td className="lp-cmp__corner" />
                  <th scope="col">Bank wire</th>
                  <th scope="col">Broker / remitter</th>
                  <th scope="col">Other B2B platforms</th>
                  <th scope="col" className="is-splash">Splash</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.feature}>
                    <th scope="row">{row.feature}</th>
                    <td><Cell value={row.bank} /></td>
                    <td><Cell value={row.broker} /></td>
                    <td><Cell value={row.platform} /></td>
                    <td className="is-splash"><Check aria-hidden="true" />{row.splash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lp-note">
            Typical published ranges, not quotes. Splash is in sandbox; no real money moves. Treasury is in test mode
            until legal sign-off.
          </p>
        </div>
      </section>

      <section id="trust" className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head">
            <div>
              <Kicker sub="Four gates">Trust</Kicker>
              <h2 className="iso-display lp-display lp-display--section">
                Every payout
                <span>proves itself.</span>
              </h2>
            </div>
            <p className="lp-lede">
              A payment on Splash cannot skip a checkpoint: verified before it&apos;s quoted, approved before it&apos;s
              signed, sent exactly as approved, anchored after it lands.
            </p>
          </div>

          <ol className="lp-gates">
            {trustGates.map((gate) => (
              <li className="lp-card lp-gate" key={gate.number}>
                <div className="lp-card__top">
                  <span className="lp-chips">
                    <span className="lp-num lp-num--gold">{gate.number}</span>
                    <span className="lp-chip">{gate.label}</span>
                  </span>
                  <gate.icon aria-hidden="true" className="lp-gate__icon" />
                </div>
                <h3 className="lp-card__title">{gate.title}</h3>
                <p className="lp-card__copy">{gate.copy}</p>
                <Tags items={gate.tags} />
              </li>
            ))}
          </ol>

          <ul className="lp-trust-foot">
            <li>Sandbox environment</li>
            <li>Not yet a licensed money-services business</li>
            <li>No real money moves</li>
          </ul>
        </div>
      </section>

      <section id="copilot" className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-zeke">
            <div className="lp-card lp-zeke__art">
              <Image src="/cinematic/copilot-desk.png" alt="" width={1200} height={896} sizes="(max-width: 1000px) 80vw, 460px" />
            </div>
            <div>
              <Kicker>Zeke</Kicker>
              <h2 className="iso-display lp-display lp-display--section">
                Zeke prepares.
                <span>You approve.</span>
              </h2>
              <p className="lp-lede">
                Zeke reads invoices, explains routes and checks the rules. It cannot sign or send; a person approves
                each payment with their device key.
              </p>
              <Tags items={['Reader', 'Router', 'Checker', 'Auditor']} />
              <button
                type="button"
                className="lp-ctrl-toggle"
                aria-expanded={ctrlOpen}
                aria-controls="control-plane"
                onClick={() => setCtrlOpen((open) => !open)}
              >
                <Workflow aria-hidden="true" />
                <span>
                  <small>The control plane</small>
                  <strong>{ctrlOpen ? 'Hide the pipeline' : 'See the pipeline it runs'}</strong>
                </span>
                <ChevronRight aria-hidden="true" className="lp-ctrl-toggle__chevron" />
              </button>
            </div>
          </div>

          {ctrlOpen ? (
            <div className="lp-card lp-ctrl" id="control-plane">
              <div className="lp-head">
                <div>
                  <Kicker>The control plane</Kicker>
                  <h2 className="iso-display lp-display lp-display--small">
                    Shipped, not
                    <span>promised.</span>
                  </h2>
                </div>
                <p className="lp-lede">
                  Every Zeke recommendation runs this exact pipeline before money can move. The phase names below
                  are the engine&apos;s own state machine; inspect them in the Action Queue.
                </p>
              </div>
              <ControlPlaneExplainer />
            </div>
          ) : null}
        </div>
      </section>

      <section className="lp-sec lp-sec--flush lp-sec--last">
        <div className="lp-wrap">
          <div className="lp-band lp-close">
            <div>
              <Kicker>Move money better</Kicker>
              <h2 className="iso-display lp-display lp-display--close">
                Pay the supplier.
                <span>Keep the proof.</span>
              </h2>
              <p className="lp-close__copy">
                Start in the sandbox: your own vault, a test payout partner, and a record for every payment.
              </p>
              <div className="lp-actions">
                <Link href="/signup" className="lp-btn lp-btn--gold lp-btn--lg">Start sending</Link>
                <Link href="/login" className="lp-btn lp-btn--ghost lp-btn--lg">Log in</Link>
              </div>
            </div>
            <div className="lp-close__card">
              <Image
                src="/isometric/gen/close-payment-card.webp"
                alt="Example payment: you send US$5,012.50 from Malaysia; the supplier receives PHP 287,000.00 in the Philippines; delivered to the bank; fees US$12.50; the receipt verifies."
                width={559}
                height={1056}
                sizes="(max-width: 860px) 180px, 254px"
              />
            </div>
          </div>
        </div>
      </section>

      <footer className="iso-footer cin-footer">
        <div className="iso-shell cin-footer-grid">
          <div className="cin-footer-brand">
            <span className="cin-footer-logo">
              <Image src="/splash-main-icon.png" alt="" width={841} height={823} />
              <strong>Splash</strong>
            </span>
            <p>Supplier payments from Malaysia to the Philippines, with proof for the auditor.</p>
            <div className="cin-footer-status" aria-label="Network status">
              <span><i aria-hidden="true" /> Sandbox · Solana devnet</span>
              <span><i aria-hidden="true" /> Settlement on Solana</span>
              <span><i aria-hidden="true" /> {lockedCopy.agent}</span>
            </div>
          </div>

          <nav className="cin-footer-col" aria-label="Product">
            <strong>Product</strong>
            <a href="#how-it-works">How it works</a>
            <a href="#comparison">Compare</a>
            <a href="#platform">Platform</a>
            <Link href="/working-capital">Working capital</Link>
            <a href="#corridors">Routes</a>
          </nav>

          <nav className="cin-footer-col" aria-label="Trust">
            <strong>Trust</strong>
            <Link href="/trust">Trust &amp; compliance</Link>
            <a href="#copilot">Zeke control plane</a>
            <Link href="/login">Log in</Link>
            <Link href="/signup">Open payment desk</Link>
          </nav>

          <div className="cin-footer-col cin-footer-compliance">
            <strong>Compliance</strong>
            <small>{claims.footerLegal.claim}</small>
          </div>
        </div>

        <div className="cin-footer-bar">
          <div className="iso-shell cin-footer-bar-inner">
            <span>{BRAND.copyright()}</span>
            <span className="cin-footer-tick">
              Settlement on Solana · Evidence encrypted with Seal, stored on Walrus
            </span>
          </div>
        </div>
      </footer>
      <button
        type="button"
        ref={backToTop}
        className={`iso-back-to-top ${showBackToTop ? 'is-visible' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}
        aria-label="Back to top"
      >
        <ArrowUp aria-hidden="true" />
      </button>
    </main>
  );
}
