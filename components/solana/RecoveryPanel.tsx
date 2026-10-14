'use client';

import { shortKey } from './client';
import { useCompany } from './useCompany';

/**
 * The recovery kit, honestly: Splash never had the 24 words, so it cannot show them again. Making a
 * new kit means replacing the recovery member of the vault, which the vault's members approve.
 */
export function RecoveryPanel() {
  const { state } = useCompany();
  if (state.status === 'loading') return <p className="sx-muted">Loading…</p>;
  if (state.status !== 'ready') {
    return (
      <div className="sx-notice sx-notice-error" role="alert">
        <p>{state.message}</p>
      </div>
    );
  }
  const kit = state.company.vault?.members.find((m) => m.role === 'recovery_kit_a') ?? null;

  return (
    <div className="sx-stack-lg">
      <section className="sx-card sx-stack" aria-labelledby="kit-title">
        <h2 id="kit-title">Your recovery kit</h2>
        {kit ? (
          <dl className="sx-kv">
            <dt>Its key, one of your approvers</dt>
            <dd className="sx-mono" title={kit.publicKey}>
              {shortKey(kit.publicKey, 10)}
            </dd>
            <dt>What it can do</dt>
            <dd>Approve on its own, like a device. It exists so a lost or broken device never locks your company out of its money.</dd>
          </dl>
        ) : (
          <p className="sx-muted">No accounts yet. Account setup makes the kit before your accounts.</p>
        )}
      </section>

      <section className="sx-card-quiet sx-stack" aria-labelledby="show-title">
        <h2 id="show-title">Why the words can&rsquo;t be shown again</h2>
        <p>
          The 24 words were made in your browser and never sent to Splash. There is no copy to show you, and nobody at Splash can recover them. Keep the paper somewhere safe and
          offline.
        </p>
      </section>

      <section className="sx-card-quiet sx-stack" aria-labelledby="rotate-title">
        <h2 id="rotate-title">Make a new kit</h2>
        <p>
          If the paper is lost or seen by someone else, make a new kit and replace the old key. Replacing it changes who can approve, and it is approved on your devices;
          once it is done, the old words can no longer approve anything.
        </p>
        <p className="sx-muted">Not in this build yet. Replacing the recovery key is listed under &ldquo;Not verified yet&rdquo;.</p>
      </section>
    </div>
  );
}
