// iso-ui
// iso-ui states: 5
'use client';

import { useMemo, useState } from 'react';
import { MotionConfig } from 'framer-motion';

import {
  ActionBar,
  AmountField,
  Combobox,
  CountUp,
  Details,
  Hop,
  IsoButton,
  IsoDisplay,
  IsoSurface,
  LaneGroup,
  MaskedField,
  QuoteRing,
  RouteMap,
  ScrollRegion,
  Segmented,
  Sheet,
  Station,
  StepRail,
  Tag,
  TestModeBadge,
  TextField,
  Ticket,
  Wire,
} from '@/components/iso';
import { formatPhp, formatUsd } from '@/lib/solana-zeke/router';

/*
 * The living style sheet (prompt 10 §2). It shows each primitive on its own, so it carries more than
 * one extruded number: one per sample below (the display sizes, the route map, the ticket and the
 * count-up), each its own state. A product screen still has exactly one per visible state.
 */

const SWATCHES: Array<[string, string]> = [
  ['--paper', 'Surfaces'],
  ['--ground', 'Page'],
  ['--ink', 'Text, outlines'],
  ['--ink-deep', 'Ledges, extrusion'],
  ['--teal', 'Routes, links, active'],
  ['--mint', 'The chosen road'],
  ['--gold', 'Coins, Test mode, treasury'],
  ['--coral', 'Approval only'],
  ['--amber-fill', 'Warnings'],
  ['--ok-fill', 'Covered, verified'],
  ['--danger-fill', 'Failures'],
  ['--mint-wash', 'Hero wash'],
];

const BANKS = [
  { value: 'bdo', label: 'BDO Unibank', meta: 'InstaPay and PESONet', keywords: 'BDO' },
  { value: 'bpi', label: 'Bank of the Philippine Islands', meta: 'InstaPay and PESONet', keywords: 'BPI' },
  { value: 'mbt', label: 'Metrobank', meta: 'InstaPay and PESONet' },
  { value: 'lbp', label: 'Land Bank of the Philippines', meta: 'PESONet only' },
  { value: 'idn', label: 'Bank Central Asia', meta: 'Indonesia · next', disabled: true },
];

const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <IsoSurface aria-label={title}>
      <h2 className="iso-h2" style={{ marginBottom: 16 }}>
        {title}
      </h2>
      {children}
    </IsoSurface>
  );
}

export function ConceptSheet() {
  const [lane, setLane] = useState<'cheapest' | 'fastest'>('cheapest');
  const [kind, setKind] = useState<'business' | 'individual'>('business');
  const [sweep, setSweep] = useState<'hold' | 'sweep'>('hold');
  const [amount, setAmount] = useState('287,000.00');
  const [acct, setAcct] = useState('');
  const [acct2, setAcct2] = useState('');
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [bank, setBank] = useState<string | null>('bdo');
  const [name, setName] = useState('');
  const [sheet, setSheet] = useState(false);
  const [moving, setMoving] = useState(true);
  // Fixed on first render, so the samples count down from 48 s, 8 s and zero.
  const [expiry] = useState(() => ({ fresh: inSeconds(48), warn: inSeconds(8), gone: inSeconds(-1) }));
  const usd = useMemo(() => (m: bigint) => formatUsd(m), []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="iso iso-page">
        <header className="iso-pagehead">
          <div>
            <h1 className="iso-title">Splash Iso UI</h1>
            <p className="iso-context">
              Look 9: every part the redesigned dashboard is built from, in every state. <strong>Development only.</strong>
            </p>
          </div>
          <TestModeBadge />
        </header>

        <Section title="Colours">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            {SWATCHES.map(([v, use]) => (
              <div key={v} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span aria-hidden="true" style={{ width: 36, height: 36, background: `var(${v})`, border: '1.5px solid var(--ink-deep)' }} />
                <span className="iso-small">
                  <strong style={{ color: 'var(--ink-deep)' }}>{v}</strong>
                  <br />
                  {use}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Type and the extruded number">
          <div className="iso-stack">
            <IsoDisplay size="xl">US$96,460.00</IsoDisplay>
            <IsoDisplay size="md">₱287,000</IsoDisplay>
            <p className="iso-body">
              Geist for everything, Geist Mono for account digits and invoice numbers only (<span className="iso-mono">INV-0415</span>,{' '}
              <span className="iso-mono">•••• 4471</span>). Sentence case, tabular numbers for all money. Scale 13 / 14 / 15 / 17 / 19 / 22 / 34.
            </p>
            <p className="iso-small">The count-up runs once, on first load, and not at all with reduced motion:</p>
            <IsoDisplay size="lg">
              <CountUp minor={96_460_000_000n} format={usd} />
            </IsoDisplay>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="iso-stack">
            <div className="iso-actions">
              <IsoButton variant="primary">Pay an invoice</IsoButton>
              <IsoButton variant="quiet">New transfer</IsoButton>
              <IsoButton variant="approve" size="lg">
                Approve on this device
              </IsoButton>
              <IsoButton variant="link">See all rules</IsoButton>
            </div>
            <div className="iso-actions">
              <IsoButton variant="primary" disabledReason="Check the bank details by phone first." >
                Confirm and pay
              </IsoButton>
              <IsoButton variant="approve" busy>
                Approving on this device…
              </IsoButton>
            </div>
            <div className="iso-surface--ink" style={{ padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <IsoButton variant="onink">Back</IsoButton>
              <IsoButton variant="paper" size="lg">
                Review and approve
              </IsoButton>
            </div>
          </div>
        </Section>

        <Section title="Tags and badges">
          <div className="iso-row">
            <Tag tone="coral">Approve</Tag>
            <Tag tone="amber">Verify</Tag>
            <Tag tone="ok" tick>
              Paid · proof recorded
            </Tag>
            <Tag tone="ink">Next</Tag>
            <Tag tone="gold">Treasury</Tag>
            <Tag tone="danger">Returned</Tag>
            <TestModeBadge />
            <TestModeBadge inline />
          </div>
          <div className="iso-ribbon" style={{ marginTop: 14 }}>
            Test mode · Investments aren&rsquo;t live until legal sign-off in Malaysia. Buttons work on test money.
          </div>
          <div className="iso-stack" style={{ marginTop: 14 }}>
            <p className="iso-note iso-note--amber">
              <strong>New bank details.</strong> Call them on a number you know before paying.
            </p>
            <p className="iso-note iso-note--ok">Covered. Enough for everything due in the next 30 days.</p>
            <p className="iso-note iso-note--danger">The partner returned the money. Check the account number with the supplier.</p>
          </div>
        </Section>

        <IsoSurface hero aria-label="Route map">
          <div className="iso-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 className="iso-h2">Route map</h2>
            <IsoButton variant="quiet" size="sm" onClick={() => setMoving((v) => !v)}>
              {moving ? 'Show it quiet' : 'Show it moving'}
            </IsoButton>
          </div>
          <RouteMap label="How the money moves" wireTop={46}>
            <Station art={{ kind: 'coin', coin: 'usd' }} label="Your account" amount="US$5,000.00" help="Payments account · you approve" wide />
            <Wire state={moving ? 'active' : 'quiet'} />
            <Hop show={lane === 'cheapest'}>
              <Station art={{ kind: 'block', glyph: 'arrow' }} label="Lower-cost lane" help="The partner's cheaper way in" />
              <Wire state={moving ? 'active' : 'quiet'} />
            </Hop>
            <Station art={{ kind: 'block', glyph: 'partner' }} label="Payout partner" help="Philippines · name shown once signed" />
            <Wire state={moving ? 'active' : 'quiet'} />
            <Station art={{ kind: 'coin', coin: 'php', late: true }} label="BDO Unibank •••• 4471" wide help="Manila Freight · PESONet">
              <IsoDisplay size="md">₱287,000</IsoDisplay>
            </Station>
          </RouteMap>
          <div style={{ marginTop: 18 }}>
            <LaneGroup
              label="Route"
              value={lane}
              onChange={setLane}
              options={[
                { value: 'cheapest', labels: ['Cheapest'], price: 'US$5,012.50', sub: "3 steps · partner fee 0.15% · uses the partner's lower-cost lane" },
                { value: 'fastest', labels: ['Fastest'], price: 'US$5,015.00', sub: '2 steps · partner fee 0.20% · straight to the partner' },
              ]}
            />
          </div>
          <div style={{ marginTop: 6 }}>
            <Details summary="How it moves">
              Both routes pay Manila Freight the full ₱287,000. The cheapest one first moves your dollars to the partner&rsquo;s lower-cost lane, where
              the partner charges 0.15% instead of 0.20%. It&rsquo;s one more step for a lower fee.
            </Details>
          </div>
        </IsoSurface>

        <Section title="Stations: the pipeline">
          <RouteMap label="Payments this month">
            <Station art={{ kind: 'tile', value: '1', tone: 'coral' }} label="Waiting approval" help={formatPhp(28_700_000n)} href="#pipeline" />
            <Wire state="quiet" />
            <Station art={{ kind: 'tile', value: '0' }} label="Sent" help="nothing moving" />
            <Wire state="done" />
            <Station art={{ kind: 'tile', value: '2', tone: 'live' }} label="With partner" help="payout partner, PH" current />
            <Wire state="active" />
            <Station art={{ kind: 'coin', coin: 'php', size: 64 }} label="Paid to bank" help="2 · ₱610,000.00" />
            <Wire state="quiet" />
            <Station art={{ kind: 'proof', tone: 'ok' }} label="Proof recorded" help="2 of 2 verify" />
          </RouteMap>
        </Section>

        <Section title="Fields">
          <div className="iso-grid-2">
            <AmountField label="They receive" currency="PHP" value={amount} onChange={setAmount} help="Paid out by PESONet" />
            <TextField label="Account holder name" value={name} onChange={setName} help="The bank doesn't check names. A mismatch comes back, so we ask you to confirm by phone." />
            <MaskedField label="Account number" value={acct} onChange={setAcct} help="As it appears on the invoice or statement." />
            <MaskedField
              label="Account number, again"
              value={acct2}
              onChange={(v) => {
                setAcct2(v);
                setPasteNote(null);
              }}
              noPaste
              onPasteBlocked={setPasteNote}
              match={acct.length >= 8 && acct === acct2}
              error={pasteNote ?? (acct2.length >= acct.length && acct2 !== acct && acct2.length > 0 ? 'The two entries are different.' : null)}
            />
            <Combobox label="Bank" options={BANKS} value={bank} onChange={setBank} placeholder="Search for a bank" />
            <div className="iso-field">
              <span className="iso-field__label">Recipient is</span>
              <Segmented
                label="Recipient is"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'business', label: 'A business' },
                  { value: 'individual', label: 'An individual' },
                ]}
              />
              <span className="iso-field__help">A business needs its SEC or DTI number.</span>
            </div>
            <AmountField label="Amount" currency="US$" value="" onChange={() => undefined} error="Above today's limit: US$12,400.00 left." />
            <label className="iso-check">
              <input type="checkbox" />
              <span>I confirm this money comes from our business revenue and belongs to the company.</span>
            </label>
          </div>
        </Section>

        <Section title="Step rail">
          <div className="iso-stack">
            <StepRail
              current={2}
              steps={[
                { label: 'Recipient', href: '#rail' },
                { label: 'Amount', href: '#rail' },
                { label: 'Quote & send' },
                { label: 'Approve' },
                { label: 'Track' },
              ]}
            />
            <StepRail current={0} steps={[{ label: 'Recipient' }, { label: 'Amount' }, { label: 'Quote & send' }, { label: 'Approve' }, { label: 'Track' }]} />
          </div>
        </Section>

        <Section title="Quote ring">
          <div className="iso-row" style={{ gap: 24 }}>
            <QuoteRing expiresAt={expiry.fresh} />
            <QuoteRing expiresAt={expiry.warn} />
            <QuoteRing expiresAt={expiry.gone} onRefresh={() => undefined} />
            <QuoteRing expiresAt={expiry.fresh} tone="coral" size={14} prefix="quote ends in" />
          </div>
        </Section>

        <Section title="Ticket">
          <div style={{ maxWidth: 640 }}>
            <Ticket
              card
              aria-label="Sample approval card"
              band={
                <>
                  <span>
                    Drafted by Zeke · <strong>a person approves</strong>
                  </span>
                  <span className="iso-num">New quote in 0:41</span>
                </>
              }
              footer={
                <div className="iso-actions">
                  <IsoButton variant="approve" size="lg">
                    Approve on this device
                  </IsoButton>
                  <IsoButton variant="quiet" size="lg">
                    Cancel
                  </IsoButton>
                </div>
              }
            >
              <h3 className="iso-h3">Approve this payment</h3>
              <div className="iso-ticket__perf">
                <span className="iso-small">They receive</span>
                <IsoDisplay size="lg">₱287,000.00</IsoDisplay>
              </div>
              <dl className="iso-dl">
                <dt>You pay</dt>
                <dd>US$5,012.50</dd>
                <dt>All-in cost</dt>
                <dd>0.25% · processing included</dd>
                <dt>Paid from</dt>
                <dd>Payments account</dd>
              </dl>
            </Ticket>
          </div>
        </Section>

        <Section title="Table and tabs">
          <div className="iso-tabs" role="tablist" aria-label="Bills">
            {['To check', 'Ready to pay', 'Waiting for approval', 'Paid'].map((t, i) => (
              <button key={t} type="button" role="tab" aria-selected={i === 0} className="iso-tabs__tab">
                {t}
              </button>
            ))}
          </div>
          <ScrollRegion label="Bills">
            <table className="iso-table">
              <thead>
                <tr>
                  <th scope="col">Paid to</th>
                  <th scope="col" className="iso-r">
                    They got
                  </th>
                  <th scope="col" className="iso-r">
                    You paid
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Manila Freight Services</strong>
                    <br />
                    <span className="iso-small">
                      <span className="iso-mono">INV-0412</span> · 13 Oct
                    </span>
                  </td>
                  <td className="iso-r">₱560,000.00</td>
                  <td className="iso-r">US$9,785.40</td>
                  <td>
                    <Tag tone="ok">Paid · proof recorded</Tag>
                  </td>
                </tr>
              </tbody>
            </table>
          </ScrollRegion>
        </Section>

        <Section title="Hold or sweep, and a sheet">
          <div className="iso-row">
            <Segmented
              label="Idle cash"
              value={sweep}
              onChange={setSweep}
              options={[
                { value: 'hold', label: 'Hold' },
                { value: 'sweep', label: 'Sweep' },
              ]}
            />
            <IsoButton variant="quiet" onClick={() => setSheet(true)}>
              Open a sheet
            </IsoButton>
          </div>
          <Sheet
            open={sheet}
            onClose={() => setSheet(false)}
            title="Move money between accounts"
            footer={
              <>
                <IsoButton variant="quiet" onClick={() => setSheet(false)}>
                  Cancel
                </IsoButton>
                <IsoButton variant="primary" onClick={() => setSheet(false)}>
                  Review and approve
                </IsoButton>
              </>
            }
          >
            <AmountField label="Amount" currency="US$" value="1,000.00" onChange={() => undefined} help="From the Reserve to the Payments account." />
            <p className="iso-small">Esc or the backdrop closes it. Focus stays inside while it is open.</p>
          </Sheet>
        </Section>

        <ActionBar
          summary={
            <>
              You pay <strong>US$5,012.50</strong> · Manila Freight gets <strong>₱287,000.00</strong> · Zeke drafted this and can&rsquo;t approve
            </>
          }
        >
          <IsoButton variant="onink">Back</IsoButton>
          <IsoButton variant="paper">Review and approve</IsoButton>
        </ActionBar>
      </div>
    </MotionConfig>
  );
}
