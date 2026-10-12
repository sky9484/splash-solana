'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/dashboard/settings', label: 'General' },
  { href: '/dashboard/settings/policy', label: 'Payment rules' },
  { href: '/dashboard/settings/devices', label: 'Devices' },
  { href: '/dashboard/settings/recovery', label: 'Recovery kit' },
];

/** The settings sections, one row of tabs; the current one is marked for screen readers too. */
export default function SettingsTabs() {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label="Settings sections" className="mx-auto mb-5 w-full max-w-6xl">
      <ul className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
                  active ? 'border-[#1F4452] bg-[#1F4452] text-white' : 'border-[#326273]/20 bg-white text-[#1F4452] hover:border-[#5C9EAD]'
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
