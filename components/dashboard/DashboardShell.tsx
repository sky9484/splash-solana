// iso-ui
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import {
  FileText,
  History,
  Landmark,
  Layers,
  LayoutGrid,
  LifeBuoy,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkle,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';

import FloatingCopilot from '@/components/FloatingCopilot';
import { holdOverlay } from '@/components/iso';
import { CustodyPhaseContext, LaunchScopeContext, SweepSwitchContext } from '@/components/dashboard/CustodyPhaseContext';
import type { CustomerSession } from '@/lib/auth/customer-session';
import { badgeFor, isActive, NAV_GROUPS, setupCard, type NavIcon, type NavItem, type SetupStepLite } from '@/lib/dashboard/nav';
import type { LaunchScope } from '@/lib/launch-scope-rules';

import { ShellTopRow } from './ShellTopRow';
import { NavShellContext, useNavShellData } from './useNavShell';

/*
 * The dashboard's shell (prompt 10 Phase 1, look 9). The sidebar keeps its dark-teal gradient and
 * its collapse, locks and phone overlay; it is regrouped as Overview, then Pay, Money, Contacts and
 * Control (lib/dashboard/nav.ts), with the badges the server counts. Account setup is a card that
 * disappears when it is done. There is no top navigation header: a top row inside the content area
 * holds search, the rate strip, the one Test mode badge and the profile. Zeke floats on every page
 * except its own.
 */

/** The Zeke icon: a speech bubble with a small spark, built from two library glyphs. */
function ZekeIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span className={clsx('iso-zeke-icon', className)} style={{ width: size, height: size }} aria-hidden="true">
      <MessageSquare size={size} />
      <Sparkle size={Math.round(size * 0.46)} className="iso-zeke-icon__spark" />
    </span>
  );
}

const ICONS: Record<Exclude<NavIcon, 'zeke'>, LucideIcon> = {
  overview: LayoutGrid,
  transfer: Send,
  invoices: FileText,
  batch: Layers,
  balance: Wallet,
  treasury: Landmark,
  history: History,
  recipients: UserRound,
  rules: ShieldCheck,
};

function NavGlyph({ icon }: { icon: NavIcon }) {
  if (icon === 'zeke') return <ZekeIcon />;
  const Icon = ICONS[icon];
  return <Icon size={18} aria-hidden="true" />;
}

type DashboardShellProps = {
  children: ReactNode;
  session: CustomerSession;
  /** KYB gate state, resolved server-side in app/dashboard/layout.tsx. */
  kyb?: { state: string; blocked: boolean; reason: string };
  /** Onboarding locks, resolved by the SAME server layout from the SAME
   *  gates the money routes enforce (lib/server/kyb-gate.ts,
   *  lib/server/onboarding.ts, lib/server/custody-phase.ts). Padlocks here
   *  are presentation; the routes stay the security. Absent (no database on
   *  a dev machine) means nothing is locked, mirroring the gates' own dev
   *  posture. */
  locks?: { termsDone: boolean; moneyBlocked: boolean; custodyOn: boolean; reason: string };
  /** The operator's sweep switch (`sweepAccountEnabled()`), resolved by the
   *  same layout. Separate from `locks` because it needs no database. */
  sweepOn?: boolean;
  /** The launch scope (lib/server/launch-scope.ts), resolved by the same
   *  layout. Needs no database, so it locks even when `locks` is absent. */
  launchScope?: LaunchScope;
  /** The run mode, resolved by the same layout: offline and devnet are both "Test mode" to a customer. */
  solana?: { mode: 'offline' | 'devnet'; cluster: 'devnet' | 'mainnet-beta'; vault: { address: string; solscanUrl: string | null } | null };
  /** Account setup's steps (lib/server/onboarding.ts), for the card above the nav. Null: unreadable. */
  setup?: SetupStepLite[] | null;
};

/** The pages a USDC-only launch does not open: paying an invoice, a transfer or a batch is a payout to
 *  a bank in local currency (the payout partner's leg), which that scope leaves closed, and a move
 *  between vaults goes through the same gates. Their routes answer 403. */
const OUT_OF_STABLECOIN_SCOPE = ['/dashboard/invoices', '/dashboard/transfer', '/dashboard/batch', '/dashboard/treasury'];
const SCOPE_REASON = 'Payouts to a supplier’s bank are not open on this launch yet. Your account and its balance are.';

/** Why a page is closed, and where to go instead. The launch scope answers
 *  first: no verification or setup step opens what this launch leaves out. */
function pageLock(
  href: string,
  locks: DashboardShellProps['locks'],
  scope: LaunchScope | undefined,
): { reason: string; href: string; action: string } | null {
  if (scope === 'stablecoin' && OUT_OF_STABLECOIN_SCOPE.some((p) => href === p || href.startsWith(`${p}/`))) {
    return { reason: SCOPE_REASON, href: '/dashboard', action: 'Back to overview' };
  }
  const reason = locks ? lockReasonFor(href, locks) : null;
  return reason ? { reason, href: '/dashboard/setup', action: 'Finish account setup' } : null;
}

/**
 * The Stablecorp-pattern lock table. Zeke and Overview stay open at every
 * state: Zeke cannot move money regardless (three independent gates prove
 * it) and Overview is a read. Everything that spends follows the KYB gate:
 * paying an invoice, a transfer, a batch, and a move between the company's
 * own accounts (Treasury). Recipients only need the terms.
 */
function lockReasonFor(
  href: string,
  locks: NonNullable<DashboardShellProps['locks']>,
): string | null {
  // Parity with the routes, or the padlock lies: the spend routes require
  // BOTH the KYB gate and the terms (requireTermsAccepted), so a nav item
  // that only checked KYB would read as open and then answer 412 on submit.
  const spend = ['/dashboard/invoices', '/dashboard/transfer', '/dashboard/batch', '/dashboard/treasury'];
  const termsOnly = ['/dashboard/recipients'];
  const termsReason = 'Accept the terms in Account setup to start here.';
  // Treasury is the company's own second account, not a custody product: it follows the same gates as a payment.
  if (spend.includes(href)) {
    if (locks.moneyBlocked) return locks.reason;
    return locks.termsDone ? null : termsReason;
  }
  // History is a read of past transfers: nothing to show before verification,
  // and nothing it can spend, so the terms do not gate it.
  if (href === '/dashboard/history') return locks.moneyBlocked ? locks.reason : null;
  if (termsOnly.includes(href)) return locks.termsDone ? null : termsReason;
  return null;
}

/** The page's own lock: a sub-page (Invoices › Pay) is closed when its section is. */
function lockForPath(pathname: string, locks: DashboardShellProps['locks'], scope: LaunchScope | undefined) {
  const section = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href !== '/dashboard' && (pathname === i.href || pathname.startsWith(`${i.href}/`)));
  return pageLock(section?.href ?? pathname, locks, scope);
}

export default function DashboardShell({ children, session, kyb, locks, sweepOn, launchScope, solana, setup }: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const shell = useNavShellData();
  const card = setupCard(setup);
  // Test mode: the offline simulator or devnet, with the test payout partner. Mainnet is refused in config.
  const testMode = !solana || solana.mode === 'offline' || solana.cluster !== 'mainnet-beta';

  // A page change closes the phone menu.
  useEffect(() => {
    setMobileOpen(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [pathname]);
  // The open phone menu covers the page: the floating Zeke steps aside, and Esc closes the menu.
  useEffect(() => {
    if (!mobileOpen) return;
    const release = holdOverlay('sheet');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      release();
      document.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const navItem = (item: NavItem, variant: 'side' | 'phone') => {
    const { label, href, icon } = item;
    const lock = pageLock(href, locks, launchScope);
    const active = isActive(href, pathname);
    const badge = badgeFor(item.badge, shell?.counts ?? null);
    const rail = variant === 'side' && collapsed;
    const accessible = [label, badge ? `, ${badge.label}` : '', lock ? ` (locked: ${lock.reason})` : ''].join('');
    return (
      <Link
        key={href}
        href={lock ? lock.href : href}
        aria-current={active ? 'page' : undefined}
        aria-disabled={lock ? true : undefined}
        aria-label={rail ? accessible : undefined}
        className={clsx('iso-navitem', active && 'is-on', lock && 'is-locked', rail && 'is-rail')}
        onClick={variant === 'phone' ? () => setMobileOpen(false) : undefined}
      >
        <NavGlyph icon={icon} />
        {rail ? null : <span className="iso-navitem__label">{label}</span>}
        {rail ? null : lock ? <Lock size={13} aria-hidden="true" className="iso-navitem__lock" /> : null}
        {badge && !rail ? (
          badge.kind === 'dot' ? (
            <span className="iso-navbadge iso-navbadge--dot" role="img" aria-label={badge.label} />
          ) : (
            <span className={clsx('iso-navbadge', badge.kind === 'count' && badge.tone === 'coral' && 'iso-navbadge--coral')} aria-label={badge.label}>
              {badge.text}
            </span>
          )
        ) : null}
        {badge && rail && badge.kind === 'count' && badge.tone === 'coral' ? <span className="iso-navbadge iso-navbadge--pip" aria-hidden="true">{badge.text}</span> : null}
        {rail ? (
          <span className="iso-navtip" aria-hidden="true">
            {label}
            {badge && badge.kind !== 'dot' ? ` · ${badge.text}` : badge ? ' · not verified' : ''}
            {lock ? ' · locked' : ''}
          </span>
        ) : null}
      </Link>
    );
  };

  const groups = (variant: 'side' | 'phone') =>
    NAV_GROUPS.map((group) => (
      <div key={group.title ?? 'top'} className="iso-navgroup">
        {group.title && !(variant === 'side' && collapsed) ? <p className="iso-navgroup__title">{group.title}</p> : null}
        {group.items.map((item) => navItem(item, variant))}
      </div>
    ));

  const setupLink = card ? (
    <Link href="/dashboard/setup" className="iso-setupcard">
      <span className="iso-setupcard__head">
        <span>Account setup</span>
        <span className="iso-num">
          {card.done} of {card.total}
        </span>
      </span>
      <span className="iso-setupcard__bar" aria-hidden="true">
        <span style={{ width: `${card.pct}%` }} />
      </span>
      <span className="iso-setupcard__next">Next: {card.next}</span>
    </Link>
  ) : null;

  const footer = (variant: 'side' | 'phone') => {
    const rail = variant === 'side' && collapsed;
    return (
      <div className="iso-sidefoot">
        {testMode && !rail ? (
          <div className="iso-testcard">
            <span className="iso-testmode iso-testmode--inline">Test mode</span>
            <p>No real money moves. Only your team can approve a payment; Splash can&rsquo;t.</p>
          </div>
        ) : null}
        <div className="iso-sidefoot__links">
          <Link href="/dashboard/settings" aria-current={pathname.startsWith('/dashboard/settings') && !pathname.startsWith('/dashboard/settings/policy') ? 'page' : undefined} aria-label={rail ? 'Settings' : undefined} className={clsx('iso-navitem', rail && 'is-rail')}>
            <Settings size={18} aria-hidden="true" />
            {rail ? <span className="iso-navtip" aria-hidden="true">Settings</span> : <span className="iso-navitem__label">Settings</span>}
          </Link>
          <Link href="/dashboard/customer-service" aria-label={rail ? 'Support' : undefined} className={clsx('iso-navitem', rail && 'is-rail')}>
            <LifeBuoy size={18} aria-hidden="true" />
            {rail ? <span className="iso-navtip" aria-hidden="true">Support</span> : <span className="iso-navitem__label">Support</span>}
          </Link>
          <button type="button" onClick={() => void logout()} aria-label={rail ? 'Log out' : undefined} className={clsx('iso-navitem', rail && 'is-rail')}>
            <LogOut size={18} aria-hidden="true" />
            {rail ? <span className="iso-navtip" aria-hidden="true">Log out</span> : <span className="iso-navitem__label">Log out</span>}
          </button>
        </div>
      </div>
    );
  };

  const lock = lockForPath(pathname, locks, launchScope);

  return (
    <NavShellContext value={shell}>
      <div className="fintech-dashboard-shell iso-app flex min-h-screen">
        {/* ── Desktop sidebar ──────────────────────────────────── */}
        <aside className={clsx('iso iso-side hidden md:flex', collapsed && 'is-collapsed')} aria-label="Dashboard">
          <span className="iso-side__rings" aria-hidden="true" />
          {/* The logo is the collapse toggle, as before. */}
          <button type="button" className="iso-logo" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed}>
            <span className="iso-logo__tile">
              <Image src="/splash-main-icon.png" alt="" width={48} height={47} className="iso-logo__mark" loading="eager" unoptimized />
            </span>
            {collapsed ? null : (
              // The button's name is what it does (collapse or expand); the brand words are decoration to a screen reader.
              <span className="iso-logo__words" aria-hidden="true">
                <strong>
                  Splash<span className="iso-logo__dot">.</span>
                </strong>
                <small>Global settlement engine</small>
              </span>
            )}
          </button>

          {collapsed ? null : setupLink}

          <nav aria-label="Main" className="iso-sidenav">
            {groups('side')}
          </nav>

          {footer('side')}
        </aside>

        {/* ── Phone: the dark top bar, and the menu it opens ─────── */}
        <header className="iso iso-phonebar md:hidden">
          <Link href="/dashboard" className="iso-logo iso-logo--phone" aria-label="Splash, Overview">
            <span className="iso-logo__tile iso-logo__tile--sm">
              <Image src="/splash-main-icon.png" alt="" width={48} height={47} className="iso-logo__mark" loading="eager" unoptimized />
            </span>
            <strong>
              Splash<span className="iso-logo__dot">.</span>
            </strong>
          </Link>
          <button type="button" className="iso-phonebar__menu" onClick={() => setMobileOpen((v) => !v)} aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen} aria-controls="iso-phone-menu">
            {mobileOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
          </button>
        </header>
        {mobileOpen ? (
          <div id="iso-phone-menu" className="iso iso-side iso-side--phone md:hidden">
            <span className="iso-side__rings" aria-hidden="true" />
            {setupLink}
            <nav aria-label="Main" className="iso-sidenav">
              {groups('phone')}
            </nav>
            {footer('phone')}
          </div>
        ) : null}

        {/* ── Main content ──────────────────────────────────────── */}
        {/* Top pad: the phone bar (56 px) on a phone, none on a desktop (the top row is in the flow).
            Bottom pad 112 px everywhere: Zeke's floating button covers the bottom 92 px. */}
        <main className={clsx('fintech-dashboard-main iso-main relative z-0 min-w-0 flex-1 overflow-x-hidden', collapsed ? 'md:ml-20' : 'md:ml-[264px]')}>
          <ShellTopRow data={shell} person={session.name} role={session.userRole} company={session.organization} testMode={testMode} />
          {kyb?.blocked ? (
            <div className="iso iso-appnote" role="status">
              <p className="iso-note iso-note--amber">
                <ShieldAlert size={18} aria-hidden="true" />
                <span>
                  <strong>Read-only for now.</strong> {kyb.reason}{' '}
                  <Link href="/settings/kyb">Business verification</Link>
                </span>
              </p>
            </div>
          ) : null}
          {lock ? (
            <section className="iso iso-locked">
              <Lock size={28} aria-hidden="true" />
              <h2 className="iso-h2">Not open yet</h2>
              <p className="iso-body">{lock.reason}</p>
              <Link href={lock.href} className="iso-btn iso-btn--primary">
                {lock.action}
              </Link>
            </section>
          ) : (
            // The same custodyOn the Treasury padlock reads, for pages that
            // cannot import the server gate (StepDelivery's fund-holding tiers),
            // and the sweep switch the transfer routes also enforce.
            <SweepSwitchContext value={sweepOn ?? false}>
              <CustodyPhaseContext value={locks?.custodyOn ?? false}>
                <LaunchScopeContext value={launchScope ?? 'full'}>{children}</LaunchScopeContext>
              </CustodyPhaseContext>
            </SweepSwitchContext>
          )}
        </main>

        {/* ── Zeke, floating on every page but its own ─────────── */}
        {/* It reads the page's query (Transfer's step), so it waits for the URL on its own. */}
        <Suspense fallback={null}>
          <FloatingCopilot waiting={shell?.counts.approvals ?? 0} />
        </Suspense>
      </div>
    </NavShellContext>
  );
}
