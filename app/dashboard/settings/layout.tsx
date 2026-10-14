import type { ReactNode } from 'react';

import SettingsTabs from '@/components/dashboard/SettingsTabs';

/** General controls, the payment rules, this company's approval devices and the recovery kit. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SettingsTabs />
      {children}
    </>
  );
}
