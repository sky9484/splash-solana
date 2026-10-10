'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Activity, Database, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { adminConsolePath } from '@/lib/admin-routing';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('staff@splash.finance');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json() as { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? 'Invalid staff credentials');
      }

      toast.success('Staff session started');
      window.location.assign(adminConsolePath('/', window.location.hostname));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Admin login failed';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-login-shell">
      <section className="admin-login-story">
        <div className="admin-login-brand">
          <Image src="/splash-main-icon.png" alt="" width={48} height={47} priority />
          <span><strong>Splash Staff</strong><small>Global Settlement Engine</small></span>
        </div>
        <div className="admin-login-copy">
          <span>Restricted operations</span>
          <h1>Control money movement with proof attached.</h1>
          <p>Review compliance, monitor settlement, and preserve every operational decision from one verifiable control room.</p>
        </div>
        <div className="admin-login-art">
          <Image src="/isometric/secure.svg" alt="Isometric verified security shield" width={1448} height={1086} priority />
          <div><i /><strong>Control room live</strong><small>Sui settled / Walrus verified</small></div>
        </div>
        <div className="admin-login-signals">
          <span><ShieldCheck aria-hidden="true" /><strong>KYB review</strong><small>Evidence connected</small></span>
          <span><Activity aria-hidden="true" /><strong>Live monitor</strong><small>Settlement traced</small></span>
          <span><Database aria-hidden="true" /><strong>Audit archive</strong><small>Proof retained</small></span>
        </div>
      </section>

      <section className="admin-login-form-wrap">
        <form onSubmit={login} className="admin-login-form">
          <div className="admin-login-form-heading">
            <div><span>Staff only</span><h2>Enter control room</h2></div>
            <LockKeyhole aria-hidden="true" />
          </div>
          <p>Use your restricted staff credentials to continue.</p>
          <label>
            Staff email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
          </label>
          <button disabled={loading}>
            {loading && <Loader2 aria-hidden="true" />}
            Enter staff console
          </button>
          <div className="admin-login-note">
            <ShieldCheck aria-hidden="true" />
            <span><strong>Staff access</strong><small>ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_SESSION_SECRET must be configured. Sign-in is refused in production until they are.</small></span>
          </div>
        </form>
      </section>
    </main>
  );
}
