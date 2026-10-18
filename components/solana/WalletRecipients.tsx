// iso-ui
// copy: technical
// The crypto-wallet zone (prompt 10 §0.6): the asset and the network are named on purpose, because USDC
// sent on the wrong network is lost.
'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Combobox, IsoButton, IsoSurface, TextField } from '@/components/iso';
import { PageHead } from '@/components/dashboard/PageHead';
import type { RecipientRecord } from '@/lib/server/operations';
import { LAUNCH_SCOPE_WHY } from '@/lib/launch-scope-rules';

/** Labels for the four wallets the wallet route accepts (WALLET_PROVIDERS in lib/payments). */
const WALLET_PROVIDER_LABELS: Record<string, string> = {
  PHANTOM: 'Phantom',
  SOLFLARE: 'Solflare',
  BACKPACK: 'Backpack',
  OTHER: 'Another wallet',
};
const PROVIDERS = Object.entries(WALLET_PROVIDER_LABELS).map(([value, label]) => ({ value, label }));
const COUNTRIES = [
  { value: 'MY', label: 'Malaysia' },
  { value: 'PH', label: 'Philippines' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'SG', label: 'Singapore' },
  { value: 'TH', label: 'Thailand' },
  { value: 'VN', label: 'Vietnam' },
];
const countryLabel = (code: string) => COUNTRIES.find((c) => c.value === code)?.label ?? code;
const providerLabel = (v: string | null | undefined) => (v && v in WALLET_PROVIDER_LABELS ? WALLET_PROVIDER_LABELS[v] : 'Crypto wallet');
const SCREENING: Record<string, string> = { CLEAR: 'Screened', ATTESTED: 'Attested by admin', ERROR: 'Screening failed' };

const EMPTY = { name: '', country: 'PH', walletAddress: '', walletProvider: 'PHANTOM', attestKnownRecipient: false };

/**
 * Recipients in a USDC-only launch (lib/launch-scope-rules.ts): no bank recipient can be paid, so the
 * page offers crypto wallets only, kept in the operations store the wallet route screens and saves to.
 */
export function WalletRecipients() {
  const [rows, setRows] = useState<RecipientRecord[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/recipients')
      .then((r) => r.json())
      .then((records: RecipientRecord[]) => {
        if (active) setRows(records.filter((r) => r.payoutMethod === 'WALLET'));
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setError('');
    if (!form.name.trim() || !form.walletAddress.trim()) {
      setError('Give the recipient’s name and their wallet’s address.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/recipients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, payoutMethod: 'WALLET' }) });
      const body = (await response.json().catch(() => ({}))) as RecipientRecord & { error?: string; screeningDetail?: string };
      if (!response.ok) {
        setError(body.error ?? 'The wallet recipient could not be saved.');
        return;
      }
      setRows((prev) => [...(prev ?? []), body]);
      setForm(EMPTY);
      setAdding(false);
      toast.success(body.screeningVerdict ? `Wallet recipient saved: ${body.screeningDetail ?? body.screeningVerdict}` : 'Wallet recipient saved, unscreened. It can’t be paid until it is screened or an admin attests to it.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const response = await fetch(`/api/recipients/${id}`, { method: 'DELETE' });
    if (!response.ok) return void toast.error('The recipient couldn’t be removed.');
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    toast.success('Recipient removed');
  }

  return (
    <div className="iso iso-page">
      <PageHead
        title="Recipients"
        context={`${LAUNCH_SCOPE_WHY} Recipients are crypto wallets for now.`}
        actions={
          <IsoButton variant="primary" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            <Plus size={16} aria-hidden="true" /> New recipient
          </IsoButton>
        }
      />

      {adding ? (
        <IsoSurface className="iso-rise" aria-labelledby="wr-add">
          <h2 id="wr-add" className="iso-h2">
            New wallet recipient
          </h2>
          <div className="iso-wallet__form">
            <TextField label="Recipient name" value={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))} autoComplete="off" />
            <Combobox label="Country" options={COUNTRIES} value={form.country} onChange={(country) => setForm((f) => ({ ...f, country }))} />
            <div className="iso-wallet__wide">
              <TextField
                label="Their Solana wallet address"
                value={form.walletAddress}
                onChange={(v) => setForm((f) => ({ ...f, walletAddress: v.trim() }))}
                spellCheck={false}
                autoComplete="off"
                help={
                  <>
                    A <strong>Solana</strong> address: 32 to 44 letters and digits, with no 0x. Copy it exactly; capital letters matter. An Ethereum address won’t work, and USDC sent to the wrong network is lost.
                  </>
                }
              />
            </div>
            <Combobox label="Their wallet" options={PROVIDERS} value={form.walletProvider} onChange={(walletProvider) => setForm((f) => ({ ...f, walletProvider }))} />
          </div>
          <label className="iso-check">
            <input type="checkbox" checked={form.attestKnownRecipient} onChange={(e) => setForm((f) => ({ ...f, attestKnownRecipient: e.target.checked }))} />
            <span>If no sanctions screening provider is set up, I attest that I know this recipient and this is their wallet (admins only; recorded with your name and the time).</span>
          </label>
          {error ? (
            <p className="iso-note iso-note--danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="iso-wallet__actions">
            <IsoButton variant="primary" onClick={() => void save()} busy={saving} disabled={saving}>
              {saving ? 'Screening…' : 'Screen and save'}
            </IsoButton>
            <IsoButton variant="quiet" onClick={() => setAdding(false)}>
              Cancel
            </IsoButton>
          </div>
        </IsoSurface>
      ) : null}

      <IsoSurface pad={false} className="iso-rise iso-rise-2" aria-labelledby="wr-title">
        <div className="iso-surface--head">
          <h2 id="wr-title" className="iso-h2">
            Wallet recipients{rows ? ` (${rows.length})` : ''}
          </h2>
        </div>
        {!rows ? (
          <div className="iso-surface--pad iso-stack" aria-busy="true" aria-label="Loading recipients">
            <span className="iso-skel" style={{ height: 56 }} />
          </div>
        ) : rows.length === 0 ? (
          <div className="iso-empty">
            <p style={{ margin: 0 }}>No wallet recipients yet. Add one to pay them in USDC on Solana.</p>
          </div>
        ) : (
          <ul className="iso-list">
            {rows.map((r) => (
              <li key={r.id}>
                <div className="iso-list__main">
                  <p className="iso-list__title" style={{ marginTop: 0 }}>
                    {r.name}
                  </p>
                  <p className="iso-list__detail" style={{ margin: 0 }}>
                    {countryLabel(r.country)} · <span className="iso-mono">{r.walletAddress ? `${r.walletAddress.slice(0, 8)}…${r.walletAddress.slice(-6)}` : ''}</span> · {providerLabel(r.walletProvider)} · USDC on Solana ·{' '}
                    {SCREENING[r.screeningVerdict ?? ''] ?? 'Not screened'}
                  </p>
                </div>
                <IsoButton variant="quiet" size="sm" onClick={() => void remove(r.id)} aria-label={`Remove ${r.name}`}>
                  Remove
                </IsoButton>
              </li>
            ))}
          </ul>
        )}
      </IsoSurface>
    </div>
  );
}
