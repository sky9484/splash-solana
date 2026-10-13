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
    title: 'Transfer and fee, one transaction.',
    copy: "A payment's transfer and Splash's fee land together, or nothing moves. A batch goes in chunks, and each chunk pays all its suppliers or none.",
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

/* How it works, in the four steps prompt 07 §6.1 names. Step 04's line is one of the two the copy
   rules let name the evidence layer (scripts/copy-rules.mjs SANCTIONED_TECH_LINES). */
const flowSteps = [
  {
    id: 'vault',
    number: '01',
    title: 'Your vault',
    description: 'Your company gets its own Squads vault on Solana. Its keys are made in your browser, and no Splash key can move the money.',
    image: '/cinematic/treasury-island.png',
    imageAlt: 'An isometric vault, open, with stacked coins inside',
    width: 2752,
    height: 1536,
    stat: 'Squads, on Solana',
  },
  {
    id: 'route',
    number: '02',
    title: 'Best route by pesos received',
    description: 'Zeke reads the invoice and a person checks every field. Routes are ranked by the pesos your supplier receives, with every fee shown first.',
    image: '/cinematic/flow-review-quotes-v4.png',
    imageAlt: 'Quote cards beside a checklist and an approval stamp',
    width: 1448,
    height: 1086,
    stat: lockedCopy.fee,
  },
  {
    id: 'approve',
    number: '03',
    title: 'A person approves',
    description: "One approval on your device signs it. You don't need SOL. A payout partner then pays the supplier's bank in pesos.",
    image: '/cinematic/settlement-machine.png',
    imageAlt: 'Dollar coins pass a checkpoint and leave as peso coins on a delivery truck',
    width: 2752,
    height: 1536,
    stat: lockedCopy.agent,
  },
  {
    id: 'proof',
    number: '04',
    title: 'Proof saved',
    description: 'Proof saved: encrypted on Walrus, anchored on Solana',
    detail: 'One record per payment: the invoice, the approval, the transfer and the rate. Trace every transaction on Solscan.',
    image: '/cinematic/flow-proof-v4.png',
    imageAlt: 'An archive cabinet with a sealed certificate and a shield badge',
    width: 1448,
    height: 1086,
    stat: 'A record that lasts',
  },
] as Array<{ id: string; number: string; title: string; description: string; detail?: string; image: string; imageAlt: string; width: number; height: number; stat: string }>;

/* Metrics ticker: the moving bridge band at the bottom of the hero. */
const marqueeItems = [
  ['1 sandbox corridor', 'MY to PH'],
  ['Modeled routes', 'expand with controls'],
  ['USDC', 'settled on Solana'],
  ["You don't need SOL", 'network fees covered'],
  ['0.10%', 'Splash fee per payout'],
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
      aria-label={`${name}: ${role}`}
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
    feature: 'Rate and fees',
    bank: 'Hidden markup',
    broker: 'Cash spread',
    wise: 'Mid-market',
    splash: 'Every fee shown before you approve',
  },
  {
    feature: 'Batch payments',
    bank: 'Limited',
    broker: 'No',
    wise: 'Limited',
    splash: 'In chunks, each all-or-none',
  },
  {
    feature: 'AI assistant',
    bank: 'No',
    broker: 'No',
    wise: 'No',
    splash: lockedCopy.agent,
  },
  {
    feature: 'Proof for the auditor',
    bank: 'Siloed records',
    broker: 'Manual receipts',
    wise: 'Platform history',
    splash: 'One record per payment, encrypted',
  },
];

/* What Zeke does in this build, agent by agent (lib/solana-zeke, /dashboard/zeke). Nothing planned. */
const copilotLayers = [
  {
    icon: FileCheck2,
    title: 'Reader',
    copy: 'Reads the invoice into a draft and shows where each field came from. A person confirms every field.',
  },
  {
    icon: Gauge,
    title: 'Router',
    copy: 'Explains each route in plain words: what the supplier receives, every fee, and when it arrives.',
  },
  {
    icon: ShieldCheck,
    title: 'Checker',
    copy: 'Explains the rules a payment passed or failed. The rules run as code; Zeke cannot change or skip them.',
  },
  {
    icon: Workflow,
    title: 'Auditor',
    copy: 'Builds the evidence pack for each payment. It drafts; it never gives anyone access.',
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
    title: 'Verified before money moves.',
    copy: "Your business is verified before any payout. A supplier's new bank details are confirmed by call-back before the first payment.",
    meta: 'KYB gate · bank call-back',
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
    title: 'Exactly as approved.',
    copy: "A payment's transfer and Splash's fee land in one Solana transaction, or nothing moves. A batch goes in chunks, and each chunk is all-or-none.",
    meta: 'Settled on Solana',
  },
  {
    number: '04',
    label: 'Prove',
    icon: Anchor,
    title: 'Evidence outlives the payment.',
    copy: 'Each receipt is encrypted, kept, and anchored on Solana, so it cannot be quietly changed. Hand it to your auditor with a link.',
    meta: 'Encrypted and recorded',
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


const loopCards = [
  {
    number: '01',
    label: 'Settle',
    title: "Pay the supplier's bank.",
    copy: 'Pay suppliers in the Philippines in USDC on Solana. Every approved payout builds verified counterparties and settlement history.',
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
    image: '/cinematic/liquidity-pools.png',
    imageAlt: 'Isometric vault holding USDC in tiers',
    meta: 'Your vault · human-approved',
    roadmap: false,
  },
  {
    number: '03',
    label: 'Supply',
    title: 'Finance it, later.',
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
              network fees, so you don&apos;t need SOL. Splash charges 0.10% per payout (US$2
              minimum); the payout partner&apos;s fee is shown before you approve.
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
              Four steps.
              <span>One record.</span>
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
              <strong>Many suppliers at once</strong>
              <span>
                Upload a file. It goes in chunks sized to fit a Solana transaction, signed in one
                approval; a chunk that fails is retried on its own.
              </span>
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
                width={activeFlow.width}
                height={activeFlow.height}
                priority={activeFlow.id === 'vault'}
              />
            </div>
            <div className="iso-flow-caption">
              <span>{activeFlow.number}</span>
              <div>
                <strong>{activeFlow.title}</strong>
                <p>{activeFlow.description}</p>
                {activeFlow.detail ? <p>{activeFlow.detail}</p> : null}
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
              Splash charges when a payout leaves for a supplier&apos;s bank, shows every fee before you
              approve, and keeps one record per payment for the auditor.
            </p>
          </div>

          <div id="corridors" className="iso-corridor-layout iso-corridor-embed">
          <div className="iso-corridor-copy">
            <h2 className="iso-section-title">
              USDC in.
              <span>Pesos out.</span>
            </h2>
            <p>
              Malaysia to the Philippines is the sandbox corridor. Indonesia follows when a payout
              partner and the controls are ready.
            </p>
            <div className="iso-route-list">
              <span className="is-live">PHP sandbox</span><span>IDR next</span>
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
              approved before it&apos;s signed, sent exactly as approved, anchored after it lands.
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
              One approval-gated desk for your vault, your suppliers&apos; payouts and the proof.
              Everything runs in the sandbox until a payout partner is live.
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
            <h2 className="iso-section-title">
              Zeke drafts.
              <span>You approve.</span>
            </h2>
            <p>
              Zeke reads invoices, explains routes and checks the rules. It cannot sign or send; a
              person approves each payment with their device key.
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
                names below are the engine&apos;s own state machine; inspect them in the Action Queue.
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
              Pay the supplier.
              <span>Keep the proof.</span>
            </h2>
            <p>
              Start in the sandbox: your own vault, a mock payout partner, and a record for every payment.
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
              src="/cinematic/corridor-bridge-v3.png"
              alt="Two isometric city platforms, Kuala Lumpur and Manila, connected by a bridge"
              width={2752}
              height={1536}
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
        className={`iso-back-to-top ${showBackToTop ? 'is-visible' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
      >
        <ArrowUp aria-hidden="true" />
      </button>
    </main>
  );
}
