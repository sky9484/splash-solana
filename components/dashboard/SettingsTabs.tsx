// iso-ui
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/dashboard/settings', label: 'General' },
  { href: '/dashboard/settings/policy', label: 'Payment rules' },
  { href: '/dashboard/settings/devices', label: 'Devices' },
  { href: '/dashboard/settings/recovery', label: 'Recovery kit' },
  { href: '/dashboard/settings/account', label: 'Account details' },
];

/**
 * The settings sections, one row of tabs in the Invoices tabs' style (prompt 12 §6.1): square tabs on
 * the 2 px ink rule, the current one underlined in teal. They are links to pages, so the current one
 * is `aria-current="page"`, for screen readers too.
 */
export default function SettingsTabs() {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label="Settings sections" className="iso iso-settabs">
      <ul className="iso-tabs">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? 'page' : undefined} className="iso-tabs__tab">
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
