// iso-ui
'use client';

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { useFocusTrap } from './focus';
import { holdOverlay } from './overlay';

const noop = () => () => {};

/** True in the browser after hydration, false on the server: where a portal can go. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * A side sheet on desktop, a bottom sheet on a phone (§2.3 Sheet): focus-trapped, Esc and the
 * backdrop close it, and the floating Zeke hides while it is open.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const client = useIsClient();

  useEffect(() => (open ? holdOverlay('sheet') : undefined), [open]);
  useFocusTrap(box, open && client, onClose, initialFocus);

  if (!open || !client) return null;
  return createPortal(
    <div className="iso iso-sheet-root">
      <div className="iso-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={box} className="iso-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className="iso-sheet__grab" aria-hidden="true" />
        <div className="iso-sheet__head">
          <h2 id={titleId} className="iso-sheet__title">
            {title}
          </h2>
          <button type="button" className="iso-iconbtn" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="iso-sheet__body">{children}</div>
        {footer ? <div className="iso-sheet__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
