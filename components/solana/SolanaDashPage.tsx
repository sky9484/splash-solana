import type { ReactNode } from 'react';

import DashPageHeader from '@/components/dashboard/DashPageHeader';

import './solana.css';

/**
 * A dashboard page whose body is a Solana screen (History, Batch payout, a receipt, Rules, Devices,
 * Recovery): the dashboard's title, then the screen. The page sits in the `.iso` scope, so the older
 * `sx-*` parts take the dashboard's look (styles/iso-ui.css, "Older screens in the new look").
 */
export function SolanaDashPage({ kicker, title, description, actions, wide = false, bare = false, children }: { kicker: string; title: string; description?: ReactNode; actions?: ReactNode; wide?: boolean; /** The screen draws its own header (Transfer). */ bare?: boolean; children: ReactNode }) {
  return (
    <div className={`iso iso-page iso-legacy${wide ? ' iso-legacy--wide' : ''}`}>
      {bare ? null : <DashPageHeader kicker={kicker} title={title} description={description} actions={actions} />}
      <div className="sx sx-embedded">{children}</div>
    </div>
  );
}
