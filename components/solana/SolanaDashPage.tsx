import type { ReactNode } from 'react';

import DashPageHeader from '@/components/dashboard/DashPageHeader';

import './solana.css';

/**
 * A dashboard page whose body is a Solana screen: the dashboard's own header (kicker, title,
 * description), then the screen in the embedded Solana styles. One wrapper, so every page lines up.
 */
export function SolanaDashPage({ kicker, title, description, actions, wide = false, children }: { kicker: string; title: string; description?: ReactNode; actions?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`mx-auto w-full ${wide ? 'max-w-7xl' : 'max-w-6xl'} space-y-5`}>
      <DashPageHeader kicker={kicker} title={title} description={description} actions={actions} />
      <div className="sx sx-embedded">{children}</div>
    </div>
  );
}
