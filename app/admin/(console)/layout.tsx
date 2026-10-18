import Image from 'next/image';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Activity, Building2, ClipboardCheck, Fuel, Headphones, KeyRound, LayoutDashboard, ListChecks, ShieldOff, Stamp, UserRoundCheck, Webhook } from 'lucide-react';
import type { ReactNode } from 'react';

import AdminLogoutButton from '@/components/admin/AdminLogoutButton';
import FintechContextBar from '@/components/FintechContextBar';
import { adminConsolePath } from '@/lib/admin-routing';
import { getAdminSession } from '@/lib/server/admin-auth';

// Prompt 07 §7: the six Solana sections, then the staff work that was already here. The contract
// config page and the old transactions list are gone from the console.
const navGroups = [
  { title: 'Console', items: [{ label: 'Overview', href: '/admin', icon: LayoutDashboard }] },
  {
    title: 'Solana',
    items: [
      { label: 'Orgs and vaults', href: '/admin/orgs', icon: Building2 },
      { label: 'Payments', href: '/admin/payments', icon: Activity },
      { label: 'Fee payer', href: '/admin/fee-payer', icon: Fuel },
      { label: 'Evidence', href: '/admin/evidence', icon: Stamp },
      { label: 'Partner webhooks', href: '/admin/webhooks', icon: Webhook },
    ],
  },
  {
    title: 'Compliance',
    items: [
      { label: 'Refuse service', href: '/admin/compliance', icon: ShieldOff },
      { label: 'KYB review', href: '/admin/kyb', icon: ClipboardCheck },
      { label: 'Profile requests', href: '/admin/profile-requests', icon: UserRoundCheck },
      { label: 'Workspace access', href: '/admin/memberships', icon: KeyRound },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Support', href: '/admin/support', icon: Headphones },
      { label: 'Go-live', href: '/admin/go-live', icon: ListChecks },
    ],
  },
];
const navItems = navGroups.flatMap((g) => g.items);

export default async function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();
  const headerStore = await headers();
  const hostname = headerStore.get('host');

  if (!session) {
    redirect(adminConsolePath('/login', hostname));
  }

  return (
    <div className="fintech-admin-shell sp-page min-h-screen text-[#1f4350]">
      <aside className="fintech-admin-sidebar fixed left-0 top-0 hidden h-screen w-64 flex-col bg-[#1f4350] p-6 text-white lg:flex">
        <Link href={adminConsolePath('/', hostname)} className="flex items-center gap-3">
          <Image src="/splash-main-icon.png" alt="Splash" width={48} height={47} className="h-auto w-9" loading="eager" />
          <div>
            <div className="text-xl font-black tracking-[-0.03em]">Splash Admin</div>
            <div className="text-[12px] font-medium text-white/80">Staff console</div>
          </div>
        </Link>

        <nav className="mt-8 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" aria-label="Admin console">
          {navGroups.map((group) => (
            <div key={group.title}>
              <div className="px-3 pb-1 text-[12px] font-semibold text-white/85">{group.title}</div>
              {group.items.map(({ label, href, icon: Icon }) => (
                <Link key={href} href={adminConsolePath(href.replace('/admin', '') || '/', hostname)} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-[#A7D6DF]">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="rounded-2xl border border-white/10 bg-white/10 p-4 text-xs text-white/90">
          <div className="font-bold text-white">{session.name}</div>
          <div className="mt-1 break-all">{session.email}</div>
          <div className="mt-2 uppercase tracking-[0.16em] text-[#d8fff4]">{session.role}</div>
        </div>
        <div className="mt-4">
          <AdminLogoutButton />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#326273]/10 bg-[#E7EEF0]/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href={adminConsolePath('/', hostname)} className="flex items-center gap-2 font-black text-[#326273]">
          <Image src="/splash-main-icon.png" alt="Splash" width={48} height={47} className="h-auto w-7" loading="eager" />
          Admin
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <nav className="flex min-w-0 items-center gap-2 overflow-x-auto" aria-label="Admin console">
            {navItems.map(({ label, href, icon: Icon }) => (
              <Link key={href} href={adminConsolePath(href.replace('/admin', '') || '/', hostname)} title={label} className="shrink-0 rounded-lg border border-[#326273]/10 bg-white p-2 text-[#326273]">
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </Link>
            ))}
          </nav>
          <AdminLogoutButton variant="light" />
        </div>
      </header>

      <main className="fintech-admin-main min-h-screen p-4 lg:ml-64 lg:p-8">
        <FintechContextBar variant="admin" />
        {children}
      </main>
    </div>
  );
}
