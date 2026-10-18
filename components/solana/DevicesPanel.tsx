// iso-ui
'use client';

import { useEffect, useState } from 'react';

import { IsoSurface, Tag } from '@/components/iso';

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
 * existing members approve; Splash can never do it (config authority: none). Prompt 12 §6.1: the
 * dashboard's boxes, text at its normal size, warnings as amber notes.
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

  if (state.status === 'loading') {
    return (
      <div className="iso-stack" aria-busy="true" aria-label="Loading your devices">
        <span className="iso-skel" style={{ height: 200 }} />
      </div>
    );
  }
  if (state.status !== 'ready') {
    return (
      <p className="iso-note iso-note--danger" role="alert">
        {state.message}
      </p>
    );
  }
  const { vault, me } = state.company;
  if (!vault) {
    return (
      <IsoSurface>
        <p className="iso-body" style={{ margin: 0 }}>
          No accounts yet, so no devices. Account setup makes this device&rsquo;s key and your accounts together.
        </p>
      </IsoSurface>
    );
  }

  return (
    <>
      <IsoSurface className="iso-stack iso-rise iso-rise-2" aria-labelledby="members-title">
        <h2 id="members-title" className="iso-h2">
          Who can approve
        </h2>
        <p className="iso-body" style={{ margin: 0 }}>
          {vault.threshold} approval{vault.threshold === 1 ? '' : 's'} needed for a payment. These are the only keys that can move the money; none of them is Splash&rsquo;s.
        </p>
        <ul className="iso-devices">
          {vault.members.map((m) => {
            const mine = m.publicKey === me.deviceKey;
            return (
              <li key={m.publicKey}>
                <div className="iso-devices__who">
                  <p className="iso-devices__role">
                    <strong>{ROLE[m.role] ?? m.role}</strong>
                    {mine ? <Tag tone="ok">This is you</Tag> : null}
                  </p>
                  <span className="iso-mono iso-devices__key" title={m.publicKey}>
                    {shortKey(m.publicKey, 8)}
                  </span>
                </div>
                <span className="iso-devices__where">{m.role.startsWith('recovery') ? 'Kept offline, on paper' : mine ? (held === null ? 'Checking this browser…' : held ? 'Key is in this browser' : 'Key is not in this browser') : 'Another person’s device'}</span>
              </li>
            );
          })}
        </ul>
        {me.deviceKey && !vault.members.some((m) => m.publicKey === me.deviceKey) ? (
          <div className="iso-note iso-note--amber">
            <div>
              <strong>Your device is registered but can&rsquo;t approve yet</strong>
              <p style={{ margin: '4px 0 0' }}>It can approve once your current approvers add it, with an approval of their own. Until then it can approve nothing.</p>
            </div>
          </div>
        ) : null}
        {me.deviceKey && held === false ? (
          <div className="iso-note iso-note--amber">
            <div>
              <strong>This browser doesn&rsquo;t hold this device&rsquo;s approval key</strong>
              <p style={{ margin: '4px 0 0' }}>Approve from the browser where you set up this device. The key cannot be copied out of it, by design.</p>
            </div>
          </div>
        ) : null}
      </IsoSurface>

      <IsoSurface className="iso-stack iso-rise iso-rise-3" aria-labelledby="add-title">
        <h2 id="add-title" className="iso-h2">
          Add or replace a device
        </h2>
        <p className="iso-body" style={{ margin: 0 }}>
          A new device joins through a change to who can approve, which your current approvers approve on their own devices, the same way they approve a payment. Splash can&rsquo;t add, remove or replace an approver: nobody outside
          your company can change who approves.
        </p>
        <p className="iso-small" style={{ margin: 0 }}>
          Not in this build yet. Adding a device is listed under &ldquo;Not verified yet&rdquo;; until then a company keeps the devices it set up with.
        </p>
      </IsoSurface>
    </>
  );
}
