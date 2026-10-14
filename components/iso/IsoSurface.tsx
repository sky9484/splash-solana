// iso-ui
import type { ElementType, ReactNode } from 'react';
import clsx from 'clsx';

/**
 * A box floating off the page (prompt 11 §1.2): a near-white fill, a 1 px edge and a soft shadow; it
 * rises 3 px under a mouse and settles back. `hero` is the one hero surface on a screen: the mint wash
 * on a deeper shadow. A box inside another box is a hairline and never moves.
 */
export function IsoSurface({
  as: Tag = 'section',
  hero = false,
  pad = true,
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  hero?: boolean;
  pad?: boolean;
  className?: string;
  children: ReactNode;
  id?: string;
  'aria-labelledby'?: string;
  'aria-label'?: string;
  role?: string;
}) {
  return (
    <Tag className={clsx('iso-surface', hero && 'iso-surface--hero', pad && 'iso-surface--pad', className)} {...rest}>
      {children}
    </Tag>
  );
}
