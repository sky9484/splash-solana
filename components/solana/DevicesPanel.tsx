'use client';

import { useEffect, useState } from 'react';

import { existingDeviceKey, shortKey } from './client';
import { useCompany } from './useCompany';

const ROLE: Record<string, string> = {
  admin_device: 'Approver device (owner)',
  approver_device: 'Approver device',
  recovery_kit_a: 'Recovery kit',
  recovery_kit_b: 'Second recovery kit',
};

/**
 * The vault's members as they are on chain, which one is this person's device, and whether this
 * browser holds its key. Adding a device or changing members is a vault config transaction the
 * existing members approve; Splash can never do it (config authority: none).
 */
export function DevicesPanel() {
  const { state } = useCompany();
  const [held, setHeld] = useState<boolean | null>(null);
  const keyId = state.status === 'ready' ? state.company.me.keyId : null;

  useEffect(() => {
    if (!keyId) return;
    let stop = false;
    void existingDeviceKey(keyId).then((k) => !stop && setHeld(k !== null));
    return () => {
      stop = true;
    };
  }, [keyId]);

  if (state.status === 'loading') return <p className="sx-muted">Loading your devices…</p>;
  if (state.status !== 'ready') {
    return (
      <div className="sx-notice sx-notice-error" role="alert">
        <p>{state.message}</p>
      </div>
    );
  }
  const { vault, me } = state.company;
  if (!vault) {
    return (
      <section className="sx-card sx-stack">
        <p>No vault yet, so no devices. Account setup makes this device&rsquo;s key and the vault together.</p>
      </section>
    );
  }

  return (
    <div className="sx-stack-lg">
      <section className="sx-card sx-stack" aria-labelledby="members-title">
        <h2 id="members-title">Members of your vault</h2>
        <p className="sx-muted sx-small">
          {vault.threshold} approval{vault.threshold === 1 ? '' : 's'} needed for a payment. These are the only keys that can move the money; none of them is Splash&rsquo;s.
        </p>
        <ul className="sx-verify">
          {vault.members.map((m) => {
            const mine = m.publicKey === me.deviceKey;
            return (
              <li key={m.publicKey} className="sx-pay-row">
                <span>
                  <strong>{ROLE[m.role] ?? m.role}</strong>
                  {mine ? <span className="sx-pill sx-pill-ok" style={{ marginLeft: 8 }}>This is you</span> : null}
                  <span className="sx-mono sx-small" style={{ display: 'block' }} title={m.publicKey}>
                    {shortKey(m.publicKey, 8)}
                  </span>
                </span>
                <span className="sx-small sx-muted">{m.role.startsWith('recovery') ? 'Kept offline, on paper' : mine ? (held === null ? 'Checking this browser…' : held ? 'Key is in this browser' : 'Key is not in this browser') : 'Another person’s device'}</span>
              </li>
            );
          })}
        </ul>
        {me.deviceKey && !vault.members.some((m) => m.publicKey === me.deviceKey) ? (
          <div className="sx-notice sx-notice-warn">
            <h3>Your device is registered but not a member yet</h3>
            <p>It can approve once the vault&rsquo;s members add it with an approval of their own. Until then it can sign nothing.</p>
          </div>
        ) : null}
        {me.deviceKey && held === false ? (
          <div className="sx-notice sx-notice-warn">
            <h3>This browser does not hold your device key</h3>
            <p>Approve from the browser where you set up this device. The key cannot be copied out of it, by design.</p>
          </div>
        ) : null}
      </section>

      <section className="sx-card-quiet sx-stack" aria-labelledby="add-title">
        <h2 id="add-title">Add or replace a device</h2>
        <p>
          A new device joins the vault through a change to its members, which the current members approve on their own devices, the same way they approve a payment.
          Splash cannot add, remove or swap a member: the vault has no config authority.
        </p>
        <p className="sx-muted">Not in this build yet. Adding a device is listed under &ldquo;Not verified yet&rdquo;; until then a company keeps the devices it set up with.</p>
      </section>
    </div>
  );
}
