'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

/**
 * When a page fails, say so.
 *
 * ─── Why this file exists ───────────────────────────────────────────────────
 *
 * There was an `app/loading.tsx` and no error boundary anywhere in the tree. So
 * a server component that threw — the dashboard layout reading KYB state, for
 * instance, when the database is unreachable — left the loading screen on
 * screen. "Preparing your desk", with a ripple animation, indefinitely.
 *
 * That is worse than an error page in a specific way: a spinner is a PROMISE
 * that something is still happening. A customer watching one waits, then
 * reloads, then waits again, and never learns that nothing is coming. Support
 * hears "it's slow" for a database outage.
 *
 * It also cost real diagnostic time on this project: a flaky local Postgres
 * shim was mistaken for a client-side hydration failure, precisely because a
 * failed data read and a slow one looked identical from the browser.
 *
 * ─── What it deliberately does not say ──────────────────────────────────────
 *
 * Not the error message. `error.message` on a server exception can carry a
 * query, a connection string, or a row — this boundary renders for customers,
 * and a stack trace in front of one is an information leak dressed as
 * helpfulness. The digest is shown instead: it is the id that matches this
 * exact failure in the server logs, which is the thing support actually needs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The full error goes to the server console, where it belongs.
    console.error('[app] render failed', error);
  }, [error]);

  return (
    <main className="st sp-page sp-ground-paper">
      <section className="st-card">
        <span className="st-icon" aria-hidden="true">
          <AlertTriangle />
        </span>
        <h1>This screen could not load</h1>
        <p>
          Something on our side failed while putting this page together. Nothing you were doing was submitted or
          changed. No payment has moved.
        </p>
        <div className="st-actions">
          <button type="button" onClick={reset} className="st-btn st-btn--primary">
            Try again
          </button>
          <Link href="/dashboard" className="st-btn st-btn--quiet">
            Back to the desk
          </Link>
        </div>

        {/* The id that matches this failure in the server logs, in mono for support. Not the message:
            a server exception can carry a query or a row, and this renders for customers. */}
        {error.digest && <p className="st-ref">Reference {error.digest}</p>}
      </section>
    </main>
  );
}
