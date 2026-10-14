import { FileLock2, KeyRound, Landmark, Scale, ShieldCheck, Vault } from 'lucide-react';

/**
 * /trust (prompt 07 §8): who holds what, what Splash can and cannot do, where the licences stand, and
 * how each payment's record is kept. Every row states who holds the key or the licence TODAY.
 * Splash's own licensing is shown as in preparation, never implied as held, and the mandatory
 * not-yet-licensed line is rendered here so no page can crop it away.
 *
 * Roles, not names: no counterparty is named until its agreement is signed. The evidence paragraph
 * names the evidence layer in the two sentences scripts/copy-rules.mjs sanctions for this page, and
 * nowhere else.
 */

/** Who holds which key, and what that key can do. The business's keys move money; Splash's cannot. */
const HOLDERS = [
  {
    who: 'The business',
    holds: 'Its own Squads multisig on Solana: a payments vault and a treasury vault, with no config authority.',
    can: 'Only its own approvers can move the money in either vault.',
    side: 'business',
  },
  {
    who: 'Each approver',
    holds: 'A device key made in their own browser. It never leaves the browser.',
    can: 'Approves a payment, or a move between the two vaults, with one signature.',
    side: 'business',
  },
  {
    who: 'The recovery kit',
    holds: '24 words the business writes down and keeps offline. Splash never sees them.',
    can: 'Brings the vault back on a new device if every device is lost.',
    side: 'business',
  },
  {
    who: 'Splash: the fee payer',
    holds: 'SOL, to pay Solana network fees and the rent of the accounts a payment creates.',
    can: 'Pays fees. It never sends SOL or tokens, and it is never a member of a vault.',
    side: 'splash',
  },
  {
    who: 'Splash: the evidence key',
    holds: 'A key that signs the fingerprint of each batch of payment records.',
    can: 'Records proof. It is never a member of a vault and cannot touch one.',
    side: 'splash',
  },
  {
    who: 'Splash: the evidence sponsor',
    holds: 'A small balance that pays for changes to who may open a business’s records.',
    can: 'Pays for those changes only. It holds no customer money.',
    side: 'splash',
  },
] as const;

/**
 * The regulated roles a corridor needs, and where each stands. A counterparty is named once its
 * agreement is signed, and not before.
 */
const ROLE_ROWS = [
  {
    role: 'Payout of record',
    body: "A local payout partner holds the licence and the client relationship in the destination market, and pays the supplier's bank. Splash routes; the partner pays out.",
    status: 'Not yet signed',
  },
  {
    role: 'FX and liquidity',
    body: 'A regulated venue prices and fills the local-currency leg, sourced per corridor as volume justifies a dedicated agreement.',
    status: 'Not yet signed',
  },
];

const LICENSE_PATH = [
  { stage: 'In preparation', body: 'Labuan FSA: a money-broking application under preparation with counsel.' },
  { stage: 'Planned', body: 'Further licences are sequenced by corridor demand, and none is named until an application is filed.' },
];

const CONTROLS = [
  { label: 'A person approves', body: 'Zeke drafts payments; it cannot sign or send. A person approves each payment with their own device key, and the vault executes only with that signature.' },
  { label: 'Rules before every payment', body: 'Per-payment and daily limits, a check that the invoice was not paid before, bank details verified by call-back, and wallet screening run before the approval can be signed.' },
  { label: 'Fees shown first', body: "Splash's 0.10% fee and the payout partner's fee are on the approval card before anyone signs." },
];

export default function TrustCompliance() {
  return (
    <div className="trust-body">
      <div className="trust-mandatory" role="note">
        <ShieldCheck aria-hidden="true" />
        <p>
          <strong>Splash is not yet a licensed money-services business.</strong> Payout partners carry out the regulated payout to the supplier&rsquo;s bank; none is signed yet.
          Splash runs the software between the business&rsquo;s own vault and the partner, and never holds the money.
        </p>
      </div>

      <section className="trust-block" aria-labelledby="trust-holders">
        <h2 id="trust-holders">
          <KeyRound aria-hidden="true" /> Who holds what
        </h2>
        <p>
          The money sits in the business&rsquo;s own vault, and only its own approvers can move it. Splash holds three keys of its own, to run the service. <strong>None of Splash&rsquo;s keys can move a customer&rsquo;s money.</strong>
        </p>
        <div className="trust-table-wrap">
          <table className="trust-table">
            <thead>
              <tr>
                <th>Who</th>
                <th>What they hold</th>
                <th>What it can do</th>
              </tr>
            </thead>
            <tbody>
              {HOLDERS.map((row) => (
                <tr key={row.who}>
                  <th scope="row">
                    {row.who}
                    <span className="trust-chip" style={{ display: 'block', width: 'fit-content', marginTop: 6 }}>
                      {row.side === 'business' ? 'The business' : 'Splash'}
                    </span>
                  </th>
                  <td>{row.holds}</td>
                  <td>{row.can}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="trust-block" aria-labelledby="trust-powers">
        <h2 id="trust-powers">
          <Scale aria-hidden="true" /> What Splash can and cannot do
        </h2>
        <p>
          <strong>Splash can refuse service. Splash cannot freeze or move a customer&rsquo;s funds.</strong>
        </p>
        <p>
          If Splash stops serving a business, its fee payer stops paying that business&rsquo;s transactions and no new payment can be started through Splash. The vault stays the business&rsquo;s own: its approvers keep their keys and can still move
          the money themselves. Every such decision is recorded with the staff member who made it and the reason.
        </p>
      </section>

      <section className="trust-block" aria-labelledby="trust-roles">
        <h2 id="trust-roles">
          <Landmark aria-hidden="true" /> Rent the licence, then own it
        </h2>
        <p>
          The honest sequence for a new corridor: run on partners who already hold the licences, prove volume and controls, then bring the licences in-house. The roles that needs, and where each stands today:
        </p>
        <div className="trust-table-wrap">
          <table className="trust-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>What it means</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_ROWS.map((row) => (
                <tr key={row.role}>
                  <th scope="row">{row.role}</th>
                  <td>{row.body}</td>
                  <td>
                    <span className="trust-chip">{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="trust-block" aria-labelledby="trust-path">
        <h2 id="trust-path">
          <Vault aria-hidden="true" /> The licensing path
        </h2>
        <ul className="trust-path">
          {LICENSE_PATH.map((item) => (
            <li key={item.stage}>
              <span className="trust-chip">{item.stage}</span>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="trust-block" aria-labelledby="trust-evidence">
        <h2 id="trust-evidence">
          <FileLock2 aria-hidden="true" /> One record for every payment
        </h2>
        <p>
          The record holds the confirmed invoice (as a salted fingerprint), the approval, the transfer, the payout partner&rsquo;s signed reports and the rate.
          {' '}Each payment record is encrypted with Seal and kept on a separate storage network that runs on Sui (Walrus), and its fingerprint is anchored on Solana.
          {' '}The anchor is an SPL Memo today, and a Solana Attestation Service record once its schema is live.
        </p>
        <p>
          Records are private by default. The business decides who may open them, an auditor included, and anyone holding a receipt can check it against the anchor without opening anything.
        </p>
      </section>

      <section className="trust-block" aria-labelledby="trust-controls">
        <h2 id="trust-controls">
          <ShieldCheck aria-hidden="true" /> Controls that gate every payment
        </h2>
        <ul className="trust-controls">
          {CONTROLS.map((control) => (
            <li key={control.label}>
              <span className="trust-chip">{control.label}</span>
              <p>{control.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
