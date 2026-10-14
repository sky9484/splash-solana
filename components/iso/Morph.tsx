// iso-ui
import * as React from 'react';
import type { ReactNode } from 'react';

/** React's view-transition component: in the App Router's React; absent from a stable React (a test's render). */
const ViewTransition = (React as { ViewTransition?: typeof React.ViewTransition }).ViewTransition;

/**
 * Whether a named morph can run here: React's `ViewTransition` and the browser's
 * `document.startViewTransition` (prompt 11 Phase 3). Where it can't, the Invoices chooser plays its
 * own short fallback before it navigates.
 */
export function canMorph(): boolean {
  return !!ViewTransition && typeof document !== 'undefined' && typeof (document as { startViewTransition?: unknown }).startViewTransition === 'function';
}

/**
 * One element that persists across a navigation (prompt 10 §6.1, §8; prompt 11 Phase 3): the same
 * `name` on both pages makes it grow from where it was to where it lands, the Invoices chooser's card
 * into the page it opens. Only named pairs animate (`default="none"`), with the `iso-inv-morph` class
 * (styles/iso-ui.css). Reduced motion turns every view transition off. Without view transitions it
 * renders its children as they are.
 */
export function Morph({ name, children }: { name: string; children: ReactNode }) {
  if (!ViewTransition) return <>{children}</>;
  return (
    <ViewTransition name={name} share="iso-inv-morph" default="none">
      {children}
    </ViewTransition>
  );
}
