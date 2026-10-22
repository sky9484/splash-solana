'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Anchor,
  ArrowDownRight,
  ArrowRight,
  ArrowUp,
  BrainCircuit,
  Check,
  ChevronRight,
  FileCheck2,
  Gauge,
  PenLine,
  ShieldCheck,
  TrendingUp,
  Workflow,
  Zap,
} from 'lucide-react';

import FloatingToken from '@/components/landing/FloatingToken';
import SettlementCinematic from '@/components/landing/SettlementCinematic';
import WaitlistCta from '@/components/landing/WaitlistCta';
import ControlPlaneExplainer from '@/components/oxwal/ControlPlaneExplainer';
import RoadmapChip from '@/components/supply/RoadmapChip';
import { claims, lockedCopy } from '@/content/claims';
import { BRAND } from '@/content/brand';
import { CUSTODY_LICENCE } from '@/lib/custody-phase-rules';

const operatingLayers = [
  {
    number: '01',
    label: 'Vault',
    title: 'Your money stays yours.',
    copy: "Money sits in your business's own Squads vault. No Splash key can move it.",
    image: '/cinematic/liquidity-pools.png',
    imageAlt: 'Tiered isometric liquidity pools with gold coin reserves flowing between basins',
    meta: 'Your vault - your approval',
  },
  {
    number: '02',
    label: 'Settlement',
    title: 'Funds cannot get stuck.',
    copy: 'Every payment settles completely or not at all. It never lands halfway.',
    image: '/cinematic/settlement-machine.png',
    imageAlt: 'Isometric settlement machine turning US dollar coins into local currency through a checkpoint',
    meta: "USDC on Solana - you don't need SOL",
  },
  {
    number: '03',
    label: 'Approval',
    title: 'Zeke drafts. A person approves.',
    copy: 'Zeke drafts payments and batches. It cannot sign or send. A person approves each payment with their device key.',
    image: '/cinematic/treasury-island.png',
    imageAlt: 'Isometric floating treasury island with an open vault of reserves and orbiting coins',
    meta: 'Device key - human approval',
  },
];

const flowSteps = [
  {
    id: 'intake',
    number: '01',
    title: 'Invoice in, or type it in',
    description:
      'Two ways in: collect through a pay link or upload an accepted invoice — or start a manual transfer and fill in the recipient, bank details, amount, and purpose yourself.',
    image: '/cinematic/flow-collect-v4.png',
    imageAlt: 'Collect isometric typography with an invoice, pay link, and dollar coins',
    stat: 'Invoice or manual entry',
  },
  {
    id: 'review',
    number: '02',
    title: 'Review quotes',
    description: 'KYB, recipient status, route, fee, treasury floor, and evidence labels appear before signature.',
    image: '/cinematic/flow-review-quotes-v4.png',
    imageAlt: 'Review quotes isometric typography with FX quote cards, checklist, and approval stamp',
    stat: 'Human approval',
  },
  {
    id: 'settle',
    number: '03',
    title: 'Settle in one signature',
    description:
      'A person approves with their device key. The payment leaves your vault in USDC on Solana as approved, or stops safely before funds move.',
    image: '/cinematic/flow-settle-v4.png',
    imageAlt: 'Settle isometric typography with a coin passing an approval gate and a signing pen',
    stat: "You don't need SOL",
  },
  {
    id: 'deliver',
    number: '04',
    title: 'Deliver locally',
    description: "A payout partner pays the verified supplier's bank in local currency.",
    image: '/cinematic/flow-deliver-v4.png',
    imageAlt: 'Deliver isometric typography with a truck bringing a peso coin to a local shop',
    stat: lockedCopy.fee,
  },
  {
    id: 'proof',
    number: '05',
    title: 'Anchor the proof',
    description: 'Receipts and documents are encrypted, stored, and anchored on Solana, ready for the auditor.',
    image: '/cinematic/flow-proof-v4.png',
    imageAlt: 'Proof isometric typography with an archive vault, sealed certificate, and shield badge',
    stat: 'A record that lasts',
  },
];

/* Metrics ticker: the moving bridge band at the bottom of the hero. */
const marqueeItems = [
  ['1 sandbox corridor', 'MY to PH'],
  ['Modeled routes', 'expand with controls'],
  ['USDC', 'settled on Solana'],
  ["You don't need SOL", 'network fees covered'],
  ['0.70%', 'to local currency'],
  ['A person approves', 'Zeke drafts'],
  ['Stored proof', 'A record that lasts'],
];

// No payout partner is named here, and no logo stands in for the settlement
// network: there is no approved Solana mark in public/ yet.
const partnerRail: Array<{ src: string; name: string; role: string; logoClass?: string }> = [
  { src: '/stripe-logo.svg', name: 'Stripe', role: 'USD collection' },
  { src: '/partners/pyth.png', name: 'Pyth', role: 'FX and peg data' },
  { src: '/sumsub-logo.png', name: 'Sumsub', role: 'KYB and KYC' },
];

/** Partner badge: logo only at rest. Hover (or focus) dims the logo and
    reveals the centred name + role. Click still balloon-pops the logo. */
function PartnerBadge({ src, name, role, logoClass }: (typeof partnerRail)[number]) {
  const [popping, setPopping] = useState(false);
  return (
    <button
      type="button"
      className="iso-partner-item cin-partner"
      onClick={() => setPopping(true)}
      aria-label={`${name} — ${role}`}
    >
      <span
        className={`cin-partner-logo ${popping ? 'is-popping' : ''}`}
        onAnimationEnd={(event) => {
          if (event.animationName === 'cin-balloon') setPopping(false);
        }}
      >
        <Image src={src} alt={`${name} logo`} width={240} height={140} className={logoClass} />
      </span>
      <span className="cin-partner-reveal" aria-hidden="true">
        <strong>{name}</strong>
        <small>{role}</small>
      </span>
    </button>
  );
}

const comparisonRows = [
  {
    feature: 'Starting fee',
    bank: '3-5%',
    broker: '2-4%',
    wise: '0.5-1.5%',
    splash: lockedCopy.fee,
  },
  {
    feature: 'FX transparency',
    bank: 'Hidden markup',
    broker: 'Cash spread',
    wise: 'Mid-market',
    splash: 'Oracle-labeled quote',
  },
  {
    feature: 'Atomic settlement',
    bank: 'No',
    broker: 'No',
    wise: 'No',
    splash: 'Yes',
  },
  {
    feature: 'Batch payments',
    bank: 'Limited',
    broker: 'No',
    wise: 'Limited',
    splash: 'Native',
  },
  {
    feature: 'AI treasury copilot',
    bank: 'No',
    broker: 'No',
    wise: 'No',
    splash: lockedCopy.agent,
  },
  {
    feature: 'Early payment on invoices',
    bank: 'Manual factoring',
    broker: 'No',
    wise: 'No',
    splash: 'Buyer-approved discount offer',
  },
  {
    feature: 'Bilateral netting',
    bank: 'Manual',
    broker: 'No',
    wise: 'No',
    splash: 'Modeled in account loop',
  },
  {
    feature: 'Permanent audit trail',
    bank: 'Siloed records',
    broker: 'Manual receipts',
    wise: 'Platform history',
    splash: 'Encrypted and kept',
  },
  {
    feature: 'Recipient account ladder',
    bank: 'Bank account only',
    broker: 'Cash-out only',
    wise: 'Wise account',
    splash: 'Payout, sweep, stored balance',
  },
];

const copilotLayers = [
  {
    icon: Gauge,
    title: 'Rate intelligence',
    copy: 'Watch every corridor and surface better timing before a payment is approved.',
  },
  {
    icon: FileCheck2,
    title: 'Invoice forecasting',
    copy: 'Extract upcoming obligations from invoices while the original file stays encrypted.',
  },
  {
    icon: Workflow,
    title: 'Batch optimizer',
    copy: 'Recognize repeat corridor patterns and suggest grouped payouts with lower operating cost.',
  },
  {
    icon: TrendingUp,
    title: 'Payment drafts',
    copy: 'Draft the payment and the route, then wait for a person to approve it. Zeke cannot sign or send.',
  },
];

// Rungs 02 and 03 hold customer funds: Phase 2, behind the same custody gate
// the transfer form and /api/transfers/authorize enforce.
const recipientLadder = [
  {
    number: '01',
    title: 'Payout',
    status: 'Live-model',
    copy: 'Deliver local currency to a verified recipient through the current payout rail.',
  },
  {
    number: '02',
    title: 'Sweep account',
    status: 'Phase 2',
    copy: `A Splash account that sweeps to the recipient's bank. It holds funds, which needs ${CUSTODY_LICENCE}.`,
  },
  {
    number: '03',
    title: 'Stored balance',
    status: 'Phase 2',
    copy: 'Keep value inside the network where regulation and partner controls permit it.',
  },
];

/* Trust · Four gates — the control sequence every payout passes, in order.
   Copy stays inside content/claims.ts truth: Sumsub KYB wired, human-final
   approval, settlement, and the encrypted evidence recorded beside it. */
const trustGates = [
  {
    number: '01',
    label: 'Verify',
    icon: ShieldCheck,
    title: 'KYB on both sides.',
    copy: 'A payout only exists between verified businesses. Sumsub gates every counterparty before a quote is even prepared.',
    meta: 'Sumsub KYB · wired',
  },
  {
    number: '02',
    label: 'Approve',
    icon: PenLine,
    title: 'A person signs. Always.',
    copy: 'Zeke drafts. A person approves with their device key. No payout or batch executes without that approval.',
    meta: 'Maker-checker · human-final',
  },
  {
    number: '03',
    label: 'Settle',
    icon: Zap,
    title: 'Atomic or not at all.',
    copy: 'The prepared payment completes exactly as approved — or stops safely before funds move. No partial states.',
    meta: 'Settled on Solana',
  },
  {
    number: '04',
    label: 'Prove',
    icon: Anchor,
    title: 'Evidence outlives the payment.',
    copy: 'Receipts and encrypted documents are written where they cannot be quietly changed — a record you can hand to an auditor.',
    meta: 'Encrypted and recorded',
  },
];

const headerNavItems = [
  { href: '#how-it-works', label: 'How it works', detail: '5 steps' },
  { href: '#platform', label: 'Platform', detail: 'Pay + treasury' },
  { href: '/working-capital', label: 'Working capital', detail: 'Supply loop' },
  { href: '#corridors', label: 'Routes', detail: 'MY-PH sandbox' },
  { href: '#comparison', label: 'Compare', detail: 'Fees + proof' },
  { href: '#copilot', label: 'Zeke', detail: 'Prepare + approve' },
];


const loopCards = [
  {
    number: '01',
    label: 'Settle',
    title: "Pay the supplier's bank.",
    copy: 'Pay suppliers in the Philippines and Indonesia in USDC. Every approved payout builds verified counterparties and settlement history.',
    image: '/isometric/loop-settle-v3.png',
    imageAlt: 'Isometric settlement: a USD coin crossing an approved rail to arrive as a PHP coin',
    meta: 'USDC → PHP · sandbox',
    roadmap: false,
  },
  {
    number: '02',
    label: 'Keep',
    title: 'Keep it in your vault.',
    copy: "Money waits in your business's own Squads vault. No Splash key can move it, and a person approves every payment out.",
    image: '/isometric/loop-save-v3.png',
    imageAlt: 'Isometric treasury tiers of USD held behind an approve control',
    meta: 'Your vault · human-approved',
    roadmap: false,
  },
  {
    number: '03',
    label: 'Supply',
    title: 'Finance it — the moat.',
    copy: 'Invoices would become working capital: your buyer funds early payment against a receivable both sides can verify.',
    image: '/isometric/loop-supply.png',
    imageAlt: 'Isometric supply loop: an invoice financed early and returned as working capital',
    meta: 'Buyer-funded · no third-party lender',
    roadmap: true,
  },
];

export default function IsometricLanding({ isPhone = false }: { isPhone?: boolean }) {
  const [activeFlow, setActiveFlow] = useState(flowSteps[0]);
  // The control plane reveals below the copilot on demand — a credit-roll,
  // not a second section.
  const [ctrlOpen, setCtrlOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    function updateHeaderState() {
      setShowBackToTop(window.scrollY > Math.max(20, window.innerHeight * 0.05));
    }

    updateHeaderState();
    window.addEventListener('scroll', updateHeaderState, { passive: true });
    window.addEventListener('resize', updateHeaderState);
    return () => {
      window.removeEventListener('scroll', updateHeaderState);
      window.removeEventListener('resize', updateHeaderState);
    };
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const targets = document.querySelectorAll(
      '.iso-section > .iso-shell, .iso-partner-rail > .iso-shell',
    );
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-inview');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    targets.forEach((el) => {
      el.classList.add('cin-reveal');
      observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <main className={`iso-landing${isPhone ? ' is-phone' : ''}`}>
      <header className={`iso-header ${showBackToTop ? 'is-scrolled' : ''}`}>
        <div className="iso-shell iso-header-inner">
          <Link href="/" className="iso-brand" aria-label="Splash Finance home">
            <Image src="/splash-main-icon.png" alt="" width={841} height={823} className="iso-header-brand-icon" priority />
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
            <Link href="/signup" className="iso-button iso-button-small">
              Start sending
              <ArrowDownRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <SettlementCinematic isPhone={isPhone} />

      <div className="iso-marquee is-static" aria-label="Platform metrics">
        <div className="iso-marquee-track">
          {[...marqueeItems, ...marqueeItems].map(([value, label], index) => (
            <div className="iso-marquee-item" key={`${value}-${index}`}>
              <strong>{value}</strong>
              <span>{label}</span>
              <i aria-hidden="true">◆</i>
            </div>
          ))}
        </div>
      </div>

      <section id="loops" className="iso-section iso-loops">
        <div className="cin-drop" style={{ top: 28, right: '4%' }} aria-hidden="true">
          <FloatingToken src="/cinematic/token-usd.png" alt="US dollar token" size={104} float="cin-float-slow" />
        </div>
        <div className="iso-shell">
          <div className="iso-section-heading iso-heading-split">
            <div>
              <p className="iso-kicker">The three loops</p>
              <h2 className="iso-section-title">
                Move it. Keep it.
                <span>Finance it.</span>
              </h2>
            </div>
            <p>
              USDC on Solana already moves. Splash&apos;s job is what the transfer alone can&apos;t
              do: reach the supplier&apos;s bank, keep the money in your own vault, and turn
              invoices into working capital.
            </p>
          </div>

          <div className="iso-loops-grid">
            {loopCards.map((loop, index) => (
              <article className={`iso-loops-card iso-loops-card-${index + 1}`} key={loop.number}>
                <div className="iso-loops-meta">
                  <span>{loop.number}</span>
                  <p>{loop.label}</p>
                  {loop.roadmap ? <RoadmapChip /> : <em className="iso-loops-live"><i aria-hidden="true" /> Live</em>}
                </div>
                <div className="iso-loops-art">
                  <Image src={loop.image} alt={loop.imageAlt} width={640} height={480} />
                </div>
                <div className="iso-loops-copy">
                  <h3>{loop.title}</h3>
                  <p>{loop.copy}</p>
                  <small>{loop.meta}</small>
                  {loop.roadmap ? (
                    <Link href="/working-capital" className="iso-inline-link iso-loops-more">
                      Learn more
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          <div className="iso-loops-foot">
            <p className="iso-fee-note">
              <strong>Where the fees live:</strong> Splash&apos;s fee payer covers the Solana
              network fees, so you don&apos;t need SOL. The Splash fee applies when value leaves
              to local currency.
            </p>
            <Link href="/working-capital" className="iso-button iso-button-small">
              Explore the Supply loop
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section className="iso-partner-rail" aria-label="Infrastructure partners and benchmarks">
        <div className="iso-shell">
          <div className="iso-partner-intro">
            <span>Infrastructure &amp; Partners</span>
            <p>Partners of record on the outside. Settlement and the record inside.</p>
          </div>
          <div className="iso-partner-grid">
            {partnerRail.map((partner) => (
              <PartnerBadge key={partner.name} {...partner} />
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="iso-section iso-flow">
        <div className="cin-drop" style={{ top: 34, right: '5%' }} aria-hidden="true">
          <FloatingToken src="/cinematic/token-sgd.png" alt="Singapore dollar token" size={112} float="cin-float-drift" />
        </div>
        <div className="iso-shell iso-flow-layout">
          <div className="iso-flow-copy">
            <p className="iso-kicker">How it works</p>
            <h2 className="iso-section-title iso-section-title-light">
              Five steps.
              <span>No limbo.</span>
            </h2>
            <div className="iso-flow-tabs" role="tablist" aria-label="Settlement flow">
              {flowSteps.map((step) => {
                const active = activeFlow.id === step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={active ? 'is-active' : ''}
                    onClick={() => setActiveFlow(step)}
                  >
                    <span>{step.number}</span>
                    <strong>{step.title}</strong>
                    <ChevronRight aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <div className="iso-flow-branch">
              <strong>Manual transfer branch</strong>
              <span>
                No invoice needed: recipient, bank details, amount, and purpose typed by hand, and
                checked against KYB before anything is signed.
              </span>
            </div>
            <div className="iso-flow-branch">
              <strong>Working-capital branch</strong>
              <span>Accepted invoice to supplier discount offer to buyer approval to settlement proof.</span>
            </div>
          </div>

          <div className="iso-flow-visual" role="tabpanel" aria-live="polite">
            <div className="iso-flow-stat">
              <small>Current checkpoint</small>
              <strong>{activeFlow.stat}</strong>
            </div>
            <div className="iso-flow-image">
              <Image
                key={activeFlow.id}
                src={activeFlow.image}
                alt={activeFlow.imageAlt}
                width={1448}
                height={1086}
                priority={activeFlow.id === 'settle'}
              />
            </div>
            <div className="iso-flow-caption">
              <span>{activeFlow.number}</span>
              <div>
                <strong>{activeFlow.title}</strong>
                <p>{activeFlow.description}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="comparison" className="iso-section iso-comparison">
        <div className="cin-drop" style={{ top: 26, right: '4%' }} aria-hidden="true">
          <FloatingToken src="/cinematic/token-thb.png" alt="Thai baht token" size={104} float="cin-float-slow" />
        </div>
        <div className="iso-shell">
          <div className="iso-section-heading iso-heading-split">
            <div>
              <p className="iso-kicker">Comparison</p>
              <h2 className="iso-section-title">
                Built for business.
                <span>Designed to move.</span>
              </h2>
            </div>
            <p>
              Splash makes internal account movement free, charges when value exits to local rails, and adds
              programmable settlement, approval-led AI, and private audit proof.
            </p>
          </div>

          <div id="corridors" className="iso-corridor-layout iso-corridor-embed">
          <div className="iso-corridor-copy">
            <p className="iso-kicker">One sandbox corridor. Modeled expansion routes.</p>
            <h2 className="iso-section-title">
              USD in.
              <span>Local out.</span>
            </h2>
            <p>
              The MY-to-PH corridor is the proving ground. Additional routes stay modeled until partner, liquidity,
              and regulatory controls are ready market by market.
            </p>
            <div className="iso-route-list">
              <span className="is-live">PHP sandbox</span><span>MYR</span><span>IDR</span><span>VND</span>
              <span>THB</span><span>SGD</span><span>EUR</span><span>GBP</span>
            </div>
            <div className="iso-recipient-ladder">
              {recipientLadder.map((step) => (
                <article key={step.number}>
                  <span>{step.number}</span>
                  <div>
                    <small>{step.status}</small>
                    <strong>{step.title}</strong>
                    <p>{step.copy}</p>
                  </div>
                </article>
              ))}
            </div>
            <Link href="/signup" className="iso-inline-link">
              Open the payout desk
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>

          <div className="iso-corridor-stage">
            <Image
              src="/cinematic/corridor-bridge-v3.png"
              alt="Two isometric city platforms, Kuala Lumpur and Manila, connected by a golden bridge of flowing coins"
              width={2752}
              height={1536}
            />
          </div>
        </div>

          <div className="iso-comparison-wrap">
            <table className="iso-comparison-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Bank</th>
                  <th>Broker</th>
                  <th>Wise</th>
                  <th className="is-splash">Splash</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.feature}>
                    <th scope="row">{row.feature}</th>
                    <td>{row.bank}</td>
                    <td>{row.broker}</td>
                    <td>{row.wise}</td>
                    <td className="is-splash"><span className="iso-splash-cell"><Check aria-hidden="true" /> {row.splash}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="trust" className="iso-section iso-trust">
        <div className="cin-drop" style={{ top: 30, right: '5%' }} aria-hidden="true">
          <FloatingToken src="/cinematic/token-php.png" alt="Philippine peso token" size={104} float="cin-float-slow" />
        </div>
        <div className="iso-shell">
          <div className="iso-section-heading iso-heading-split">
            <div>
              <p className="iso-kicker">Trust · Four gates</p>
              <h2 className="iso-section-title iso-section-title-light">
                Every payout
                <span>proves itself.</span>
              </h2>
            </div>
            <p>
              A payment on Splash cannot skip a checkpoint: verified before it&apos;s quoted,
              approved before it&apos;s signed, atomic when it settles, anchored after it lands.
            </p>
          </div>

          <div className="iso-trust-rail" aria-hidden="true">
            {trustGates.map((gate) => (
              <span key={gate.number}><i /></span>
            ))}
          </div>

          <ol className="iso-trust-grid">
            {trustGates.map((gate) => (
              <li className="iso-trust-card" key={gate.number}>
                <div className="iso-trust-meta">
                  <span>{gate.number}</span>
                  <p>{gate.label}</p>
                  <gate.icon aria-hidden="true" />
                </div>
                <h3>{gate.title}</h3>
                <p>{gate.copy}</p>
                <small>{gate.meta}</small>
              </li>
            ))}
          </ol>

          <p className="iso-trust-foot">
            Sandbox environment · Not yet a licensed money-services business · No real money moves
          </p>
        </div>
      </section>

      <section id="platform" className="iso-section iso-operating">
        <div className="cin-drop" style={{ top: 30, right: '5%' }} aria-hidden="true">
          <FloatingToken src="/cinematic/token-idr-v1.png" alt="Indonesian rupiah token" size={108} float="cin-float-slow" />
        </div>
        <div className="iso-shell">
          <div className="iso-section-heading iso-heading-split">
            <div>
              <p className="iso-kicker">The platform</p>
              <h2 className="iso-section-title">
                Everything between invoice
                <span>and settlement.</span>
              </h2>
            </div>
            <p>
              One approval-gated desk for liquidity, settlement, and treasury. Funding, payout,
              receivables, and treasury actions stay sandboxed until those rails are active.
            </p>
          </div>

          <div className="iso-layer-grid">
            {operatingLayers.map((layer, index) => (
              <article className={`iso-layer-card iso-layer-card-${index + 1}`} key={layer.number}>
                <div className="iso-layer-meta">
                  <span>{layer.number}</span>
                  <p>{layer.label}</p>
                </div>
                <div className="iso-layer-art">
                  <Image src={layer.image} alt={layer.imageAlt} width={1448} height={1086} />
                </div>
                <div className="iso-layer-copy">
                  <h3>{layer.title}</h3>
                  <p>{layer.copy}</p>
                  <small>{layer.meta}</small>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="copilot" className="iso-section iso-copilot">
        <div className="iso-shell iso-copilot-layout">
          <div className="iso-copilot-stack">
          <div className="iso-copilot-stage">
            <Image
              src="/cinematic/copilot-desk.png"
              alt="Zeke, an isometric robot assistant at a desk, presenting suggestion cards"
              width={2172}
              height={1629}
            />
            <div className="iso-copilot-memory">
              <BrainCircuit aria-hidden="true" />
              <span>
                <small>Zeke drafts</small>
                <strong>It cannot sign or send. A person approves.</strong>
              </span>
            </div>
          </div>

          {/* The Zeke badge is pinned to the stage's bottom edge, so this
              sits in flow directly beneath it — the stage column's own CTA. */}
          <button
            type="button"
            className="iso-ctrl-toggle"
            aria-expanded={ctrlOpen}
            aria-controls="control-plane"
            onClick={() => setCtrlOpen((open) => !open)}
          >
            <Workflow aria-hidden="true" />
            <span>
              <small>The control plane</small>
              <strong>{ctrlOpen ? 'Hide the pipeline' : 'See the pipeline it runs'}</strong>
            </span>
            <ChevronRight aria-hidden="true" className="iso-ctrl-toggle-chevron" />
          </button>
          </div>

          <div className="iso-copilot-copy">
            <p className="iso-kicker">AI Copilot</p>
            <h2 className="iso-section-title">
              Context that gets
              <span>more useful.</span>
            </h2>
            <p>
              Zeke connects rates, invoices, and batch habits to draft the next payment. It cannot
              sign or send; a person approves each payment with their device key.
            </p>
            <div className="iso-copilot-list">
              {copilotLayers.map(({ icon: Icon, title, copy }) => (
                <article key={title}>
                  <Icon aria-hidden="true" />
                  <span>
                    <strong>{title}</strong>
                    <small>{copy}</small>
                  </span>
                </article>
              ))}
            </div>
          </div>
        </div>

        {ctrlOpen ? (
          <div className="iso-shell iso-ctrl-shell iso-ctrl-revealed" id="control-plane">
            <span className="iso-ctrl-reveal-line" aria-hidden="true" />
            <div className="iso-section-heading iso-heading-split">
              <div>
                <p className="iso-kicker">The control plane</p>
                <h2 className="iso-section-title">
                  Shipped, not
                  <span>promised.</span>
                </h2>
              </div>
              <p>
                Every Zeke recommendation runs this exact pipeline before money can move. The phase
                names below are the engine&apos;s own state machine — inspect them in the Action Queue.
              </p>
            </div>
            <ControlPlaneExplainer />
          </div>
        ) : null}
      </section>

      <section className="iso-section iso-final">
        <div className="iso-shell iso-final-panel">
          <div className="iso-final-copy">
            <p className="iso-kicker">Move money better</p>
            <h2 className="iso-section-title iso-section-title-light">
              Your global treasury,
              <span>finally programmable.</span>
            </h2>
            <p>
              Start with USDC. Prove the MY-to-PH path. Expand only when controls and partners are ready.
            </p>
            <div className="iso-hero-actions">
              <Link href="/signup" className="iso-button iso-button-gold">
                Start sending
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link href="/login" className="iso-button iso-button-dark-ghost">Log in</Link>
              <WaitlistCta tone="dark" />
            </div>
          </div>

          <div className="iso-final-art">
            <Image
              src="/isometric/payments.svg"
              alt="Isometric local currency payment receipt"
              width={1448}
              height={1086}
            />
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
            <p>Supplier payments from Malaysia to the Philippines and Indonesia, with proof for the auditor.</p>
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
              Settlement on Solana · Evidence encrypted and stored, anchored on Solana · {lockedCopy.fee}
            </span>
          </div>
        </div>
      </footer>
      <button
        type="button"
        className={`iso-back-to-top ${showBackToTop ? 'is-visible' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
      >
        <ArrowUp aria-hidden="true" />
      </button>
    </main>
  );
}
