// iso-ui
'use client';

import { useEffect, useState } from 'react';

import { IsoButton, IsoSurface, Segmented, Tag, TextField } from '@/components/iso';
import { api } from '@/components/solana/client';

type Setting = { on: boolean; handle: string | null; suggestedHandle: string; verified: boolean };

/**
 * "Let other Splash businesses find us" (prompt 10 §5.4): off by default. When it is on, a verified
 * company shows in Transfer's "Find a business on Splash" by its name, its @handle or its
 * registration number, and other businesses can pay it straight into its own Splash account. Only
 * the owner changes it.
 */
export function DirectoryCard({ isOwner }: { isOwner: boolean }) {
  const [setting, setSetting] = useState<Setting | null>(null);
  const [on, setOn] = useState<'off' | 'on'>('off');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    let stop = false;
    api<{ directory: Setting }>('/settings/directory')
      .then((r) => {
        if (stop) return;
        setSetting(r.directory);
        setOn(r.directory.on ? 'on' : 'off');
        setHandle(r.directory.handle ?? r.directory.suggestedHandle);
      })
      .catch((e: Error) => !stop && setMessage({ tone: 'danger', text: e.message }));
    return () => {
      stop = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ directory: Setting }>('/settings/directory', { method: 'PUT', body: { on: on === 'on', handle: handle.trim().replace(/^@/, '') } });
      setSetting(r.directory);
      setMessage({ tone: 'ok', text: r.directory.on ? `Listed as @${r.directory.handle}. Other Splash businesses can find and pay you.` : 'Not listed. Other Splash businesses can’t find you.' });
    } catch (e) {
      setMessage({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const changed = setting ? (on === 'on') !== setting.on || handle.trim().replace(/^@/, '') !== (setting.handle ?? setting.suggestedHandle) : false;
  return (
    <IsoSurface pad className="iso-stack" aria-labelledby="acct-directory">
      <div className="iso-row" style={{ justifyContent: 'space-between' }}>
        <h2 id="acct-directory" className="iso-h2">
          Found on Splash
        </h2>
        {setting ? setting.on ? <Tag tone="ok" tick>Listed as @{setting.handle}</Tag> : <Tag tone="ink">Not listed</Tag> : null}
      </div>
      <p className="iso-body" style={{ margin: 0 }}>
        When you’re listed, other businesses on Splash can find you by name, @handle or registration number, and pay you straight into your own Splash account, with no Splash fee. Off unless you turn it on.
      </p>
      {!setting ? (
        message ? (
          <p className="iso-note iso-note--danger" role="alert">
            {message.text}
          </p>
        ) : (
          <div className="iso-skel" style={{ height: 56 }} aria-busy="true" aria-label="Loading" />
        )
      ) : !setting.verified ? (
        <p className="iso-note iso-note--amber">Only verified companies can be listed. Finish verifying your business first.</p>
      ) : isOwner ? (
        <>
          <div className="iso-field">
            <span className="iso-field__label">Let other Splash businesses find us</span>
            <Segmented
              label="Let other Splash businesses find us"
              value={on}
              onChange={setOn}
              options={[
                { value: 'off', label: 'Not listed' },
                { value: 'on', label: 'Listed' },
              ]}
            />
          </div>
          {on === 'on' ? <TextField label="Your Splash handle" value={handle} onChange={setHandle} autoComplete="off" spellCheck={false} help="3 to 31 letters, digits or dashes. Shown as @handle." /> : null}
          <div>
            <IsoButton variant="primary" onClick={() => void save()} busy={busy} disabledReason={changed ? null : 'Nothing to save yet.'}>
              Save
            </IsoButton>
          </div>
        </>
      ) : (
        <p className="iso-small" style={{ margin: 0 }}>
          Only your company’s owner can change this.
        </p>
      )}
      {setting && message ? (
        <p className={message.tone === 'ok' ? 'iso-note iso-note--ok' : 'iso-note iso-note--danger'} role={message.tone === 'ok' ? 'status' : 'alert'}>
          {message.text}
        </p>
      ) : null}
    </IsoSurface>
  );
}
