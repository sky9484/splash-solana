import { ZEKE_AUTHORITY } from '@/lib/solana-zeke/guard';

const ROSTER: Array<{ name: string; task: string; never: string; build: string; planned?: boolean }> = [
  { name: 'Reader', task: 'Reads invoices. No tools.', never: 'sign, pay, hold a key', build: 'Built. Offline reader here; Claude when a key is set.' },
  { name: 'Router', task: 'Explains routes.', never: 'change amounts or suppliers', build: 'Built. Plain-language notes on the engine’s quotes.' },
  { name: 'Checker', task: 'Checks limits and screening.', never: 'override a rule', build: 'Built as code. The rules run outside Zeke.' },
  { name: 'Planner', task: "Shows what's due and what's short.", never: 'move money', build: 'Planned' },
  { name: 'Matcher', task: 'Matches payouts to invoices.', never: 'close a mismatch', build: 'Built as code. Partner reports matched by payment.' },
  { name: 'Auditor', task: 'Builds evidence packs.', never: 'give anyone access', build: 'Built as code. One record per payment.' },
  { name: 'Data spend', task: 'Pays for listed APIs within US$50/month.', never: 'spend outside the list or the cap', build: 'Planned', planned: true },
];

/** Who Zeke is, agent by agent, and what it can do read from the code rather than claimed. */
export function ZekeRoster() {
  const yes = (v: boolean) => (v ? 'yes' : 'no');
  return (
    <div className="sx-stack-lg">
      <section className="sx-card bg-white" aria-labelledby="roster-title">
        <h2 id="roster-title">Zeke&rsquo;s agents</h2>
        <p className="sx-muted sx-small" style={{ marginTop: 6 }}>
          Each one has one job and a line it can never cross. Zeke drafts; a person approves every payment.
        </p>
        <table className="sx-roster" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Job</th>
              <th scope="col">Can never</th>
              <th scope="col">In this build</th>
            </tr>
          </thead>
          <tbody>
            {ROSTER.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.task}</td>
                <td>{r.never}</td>
                <td>{r.planned || r.build === 'Planned' ? <span className="sx-pill sx-pill-pending">Planned</span> : r.build}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="sx-card-quiet sx-stack" aria-labelledby="auth-title">
        <h2 id="auth-title">What Zeke can do, from the code</h2>
        <ul className="sx-mock-list">
          <li>Output: {ZEKE_AUTHORITY.output}s only.</li>
          <li>Sign, send or approve: {yes(ZEKE_AUTHORITY.canSign || ZEKE_AUTHORITY.canSend || ZEKE_AUTHORITY.canApprove)}.</li>
          <li>Change amounts or recipients: {yes(ZEKE_AUTHORITY.canChangeAmounts || ZEKE_AUTHORITY.canChangeRecipients)}.</li>
          <li>
            Holds keys: {yes(ZEKE_AUTHORITY.holdsKeys)}. Tools: {ZEKE_AUTHORITY.tools.length === 0 ? 'none' : ZEKE_AUTHORITY.tools.join(', ')}.
          </li>
          <li>Zeke never touches the signing screen: the approval card is built from the confirmed invoice, the quote and the rules.</li>
        </ul>
      </section>
    </div>
  );
}
