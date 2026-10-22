// iso-ui
'use client';

import { IsoSurface } from '@/components/iso';

import { shortKey } from './client';
import { useCompany } from './useCompany';

/**
 * The recovery kit, honestly: Splash never had the 24 words, so it cannot show them again. Making a
 * new kit means replacing the recovery member of the vault, which the vault's members approve.
 */
export function RecoveryPanel() {
  const { state } = useCompany();
  if (state.status === 'loading') {
    return (
      <div className="iso-stack" aria-busy="true" aria-label="Loading your recovery kit">
        <span className="iso-skel" style={{ height: 160 }} />
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
  const kit = state.company.vault?.members.find((m) => m.role === 'recovery_kit_a') ?? null;

  return (
    <>
      <IsoSurface className="iso-stack iso-rise iso-rise-2" aria-labelledby="kit-title">
        <h2 id="kit-title" className="iso-h2">
          Your recovery kit
        </h2>
        {kit ? (
          <dl className="iso-idrows">
            <div className="iso-idrow">
              <dt>Its key, one of your approvers</dt>
              <dd>
                <span className="iso-idrow__value iso-mono" title={kit.publicKey}>
                  {shortKey(kit.publicKey, 10)}
                </span>
              </dd>
            </div>
            <div className="iso-idrow">
              <dt>What it can do</dt>
              <dd>
                <span className="iso-idrow__value">Approve on its own, like a device. It exists so a lost or broken device never locks your company out of its money.</span>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="iso-body" style={{ margin: 0 }}>
            No accounts yet. Account setup makes the kit before your accounts.
          </p>
        )}
      </IsoSurface>

      <IsoSurface className="iso-stack iso-rise iso-rise-3" aria-labelledby="show-title">
        <h2 id="show-title" className="iso-h2">
          Why the words can&rsquo;t be shown again
        </h2>
        <p className="iso-body" style={{ margin: 0 }}>
          The 24 words were made in your browser and never sent to Splash. There is no copy to show you, and nobody at Splash can recover them. Keep the paper somewhere safe and offline.
        </p>
      </IsoSurface>

      <IsoSurface className="iso-stack iso-rise iso-rise-4" aria-labelledby="rotate-title">
        <h2 id="rotate-title" className="iso-h2">
          Make a new kit
        </h2>
        <p className="iso-body" style={{ margin: 0 }}>
          If the paper is lost or seen by someone else, make a new kit and replace the old key. Replacing it changes who can approve, and it is approved on your devices; once it is done, the old words can no longer approve anything.
        </p>
        <p className="iso-small" style={{ margin: 0 }}>
          Not in this build yet. Replacing the recovery key is listed under &ldquo;Not verified yet&rdquo;.
        </p>
      </IsoSurface>
    </>
  );
}
