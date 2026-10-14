'use client';

import { useState } from 'react';

import { api, ApiError } from './client';
import { notifyCompanyChanged } from './useCompany';

/**
 * Drop a payment nothing was sent for (quoted, ready to approve, expired, blocked, or stopped before
 * the vault). Confirmed first. The record stays with the staff console as "Discarded"; it leaves the
 * company's lists, and nothing on chain is touched.
 */
export function DiscardButton({ paymentId, name }: { paymentId: string; name: string }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function discard() {
    setBusy(true);
    setError(null);
    try {
      await api(`/payments/${paymentId}/discard`, { body: {} });
      notifyCompanyChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'It could not be discarded. Try again.');
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <button type="button" className="sx-btn-link sx-small" onClick={() => setAsking(true)}>
        Discard<span className="sx-visually-hidden"> the unsent payment to {name}</span>
      </button>
    );
  }
  return (
    <span className="sx-row" role="group" aria-label={`Discard the unsent payment to ${name}?`} style={{ gap: 8 }}>
      <span className="sx-small">Discard it? Nothing was sent.</span>
      <button type="button" className="sx-btn sx-btn-sm" disabled={busy} onClick={() => void discard()}>
        {busy ? 'Discarding…' : 'Yes, discard'}
      </button>
      <button type="button" className="sx-btn-link sx-small" disabled={busy} onClick={() => { setAsking(false); setError(null); }}>
        Keep
      </button>
      {error ? (
        <span className="sx-small" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
