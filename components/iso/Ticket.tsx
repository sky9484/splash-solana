// iso-ui
'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * The receipt-shaped summary of a payment (§2.3 Ticket). The same ticket becomes the approval card
 * at Step 4: both render with one `layoutId`, so it morphs from the page into the centred card
 * (a spring; a crossfade with reduced motion, via the MotionConfig around it).
 */
export function Ticket({
  layoutId = 'transfer-ticket',
  card = false,
  band,
  footer,
  children,
  className,
  ...aria
}: {
  layoutId?: string;
  /** The approval card: the bigger ledge. */
  card?: boolean;
  band?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  role?: string;
  'aria-modal'?: boolean;
  'aria-labelledby'?: string;
  'aria-label'?: string;
}) {
  return (
    <motion.section layoutId={layoutId} transition={{ type: 'spring', stiffness: 380, damping: 34 }} className={clsx('iso-ticket', card && 'iso-ticket--card', className)} {...aria}>
      {band ? <div className="iso-ticket__band">{band}</div> : null}
      <div className="iso-ticket__body">{children}</div>
      {footer ? <div className="iso-ticket__foot">{footer}</div> : null}
    </motion.section>
  );
}
