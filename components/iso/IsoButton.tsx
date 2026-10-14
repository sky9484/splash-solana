// iso-ui
'use client';

import Link from 'next/link';
import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import clsx from 'clsx';

export type IsoButtonVariant = 'primary' | 'approve' | 'quiet' | 'link' | 'paper' | 'onink';

type Common = {
  variant?: IsoButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  /** Shown beside a disabled button: a disabled control always says why (§2.3). */
  disabledReason?: string | null;
  busy?: boolean;
  className?: string;
  children: ReactNode;
};

type ButtonProps = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { href?: undefined; /** React 19 passes a ref as a prop: the approval moment focuses its main button. */ ref?: Ref<HTMLButtonElement> };
type LinkProps = Common & { href: string; onClick?: () => void; 'aria-label'?: string };

function classes({ variant = 'quiet', size = 'md', block, busy, className }: Common) {
  return clsx('iso-btn', `iso-btn--${variant}`, size !== 'md' && `iso-btn--${size}`, block && 'iso-btn--block', busy && 'iso-btn--busy', className);
}

/**
 * The one button. `primary` (teal, paper text), `approve` (coral, ink text: approval only),
 * `quiet` (paper, outline), `link`; `paper` and `onink` sit on the ink action bar. Hover lifts 1 px,
 * press pushes it 2 px into its ledge. 48 px tall (52 px for a step's main action).
 */
export function IsoButton(props: ButtonProps | LinkProps) {
  const reasonId = useId();
  const cls = classes(props);
  const reason = props.disabledReason ? (
    <span id={reasonId} className="iso-btn-why">
      {props.disabledReason}
    </span>
  ) : null;

  if (props.href !== undefined) {
    const { href, onClick, children, disabledReason } = props;
    if (disabledReason) {
      return (
        <span className="iso-btn-wrap">
          <span className={cls} role="link" aria-disabled="true" aria-describedby={reasonId}>
            {children}
          </span>
          {reason}
        </span>
      );
    }
    return (
      <Link href={href} className={cls} onClick={onClick} aria-label={props['aria-label']}>
        {children}
      </Link>
    );
  }

  const { variant, size, block, disabledReason, busy, className, children, type = 'button', disabled, ...rest } = props;
  void variant;
  void size;
  void block;
  void className;
  const button = (
    <button
      {...rest}
      type={type}
      className={cls}
      disabled={Boolean(disabled || disabledReason || busy)}
      aria-busy={busy || undefined}
      aria-describedby={disabledReason ? reasonId : rest['aria-describedby']}
    >
      {children}
    </button>
  );
  // The same outer element with or without a reason: when a button becomes enabled (its reason goes
  // away) React updates it in place, so it keeps keyboard focus. Without a reason the host is
  // layout-transparent (`display: contents`).
  return (
    <span className={reason ? 'iso-btn-wrap' : 'iso-btn-host'}>
      {button}
      {reason}
    </span>
  );
}
