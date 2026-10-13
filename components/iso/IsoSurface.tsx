// iso-ui
import type { ElementType, ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Flat paper with a border and no shadow. `hero` is the one hero surface on a screen: the mint wash
 * with the 24 px grid, a 2 px ink border and the 6 px ledge (decision 20).
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
