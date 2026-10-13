// iso-ui
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

import { ActionBar, AmountField, Combobox, IsoButton, IsoDisplay, IsoSurface, Segmented, Tag, TextField } from '@/components/iso';
import { useNavShell } from '@/components/dashboard/useNavShell';

import { api, php, usd } from '../client';
import type { CompanyDTO } from '../types';
import { minorFromTyped, phpWhole, problemOf, shortName, typedFromMinor, usdWhole, type AmountDraft, type DetailsOptions, type EstimateDTO, type Payee, type Problem, type RecipientRow } from './shared';

type Side = 'php' | 'usd';
const WORKING = 'Working out the other amount…';
type Ask = { side: Side; minor: string } | null;

/** The other amount follows the one typed: tweened over 240 ms, with integer steps (display only). */
function useTween() {
  const reduce = useReducedMotion();
  const frame = useRef<number | null>(null);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);
  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const run = useCallback(
    (from: bigint, to: bigint, apply: (v: bigint) => void) => {
      cancel();
      if (reduce || from === to) {
        apply(to);
        return;
      }
      const start = performance.now();
      const step = (t: number) => {
        const k = Math.min(1000, Math.round(((t - start) / 240) * 1000));
        const eased = 1000 - Math.floor(((1000 - k) * (1000 - k)) / 1000);
        apply(from + ((to - from) * BigInt(eased)) / 1000n);
        frame.current = k < 1000 ? requestAnimationFrame(step) : null;
      };
      frame.current = requestAnimationFrame(step);
    },
    [reduce, cancel],
  );
  return { run, cancel };
}

/**
 * Step 2, the amount (prompt 10 §5.5, frame Flow-T2-Amount).
 *
 *   bank   "They receive" in PHP and "You send, before fees" in US$, coupled: typing either asks the
 *          server for the other about 300 ms after the last key, at the partner's rate, and names the
 *          rail ("Paid out by PESONet"). What it's for: a reference, Goods or Services and what was
 *          bought, and the two questions the partner asks of every transfer.
 *   peer   the amount in US$ and a note that goes on both receipts.
 *
 * Today's limits are shown, and an amount above one is stopped here with the rule's name. The exact
 * cost is the next step's quote.
 */
export function StepAmount({
  company,
  kind,
  recipient,
  payee,
  options,
  draft,
  busy,
  problem,
  onBack,
  onNext,
}: {
  company: CompanyDTO;
  kind: 'bank' | 'peer';
  recipient: RecipientRow | null;
  payee: Payee | null;
  options: DetailsOptions | null;
  draft: AmountDraft | null;
  busy: boolean;
  problem: Problem | null;
  onBack: () => void;
  onNext: (d: AmountDraft) => void;
}) {
  const shell = useNavShell();
  const { run: tween, cancel: stopTween } = useTween();
  const answers = recipient?.lastAnswers ?? null;
  const [phpText, setPhpText] = useState(() => typedFromMinor(draft?.phpMinor ?? null, 2));
  const [usdText, setUsdText] = useState(() => typedFromMinor(draft?.usdMinor ?? null, 6));
  const [ask, setAsk] = useState<Ask>(() => (draft ? (kind === 'bank' && draft.phpMinor ? { side: 'php', minor: draft.phpMinor } : { side: 'usd', minor: draft.usdMinor }) : null));
  const [estimate, setEstimate] = useState<EstimateDTO | null>(null);
  const [rateLabel, setRateLabel] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estProblem, setEstProblem] = useState<Problem | null>(null);
  const [reference, setReference] = useState(draft?.reference ?? '');
  const [purpose, setPurpose] = useState<AmountDraft['purpose']>(draft?.purpose ?? answers?.purpose ?? 'goods');
  const [description, setDescription] = useState(draft?.description ?? answers?.description ?? '');
  const [relationship, setRelationship] = useState<AmountDraft['relationship']>(draft?.relationship ?? answers?.relationship ?? null);
  const [sourceOfFunds, setSourceOfFunds] = useState<AmountDraft['sourceOfFunds']>(draft?.sourceOfFunds ?? answers?.sourceOfFunds ?? null);
  const [note, setNote] = useState(draft?.note ?? '');
  const [tried, setTried] = useState(false);
  // Pressed while the other amount was still being worked out: go on as soon as it is.
  const [queued, setQueued] = useState(false);
  const shown = useRef<{ php: bigint; usd: bigint }>({ php: BigInt(draft?.phpMinor ?? 0), usd: BigInt(draft?.usdMinor ?? 0) });

  // Ask the server for the other amount, the rail and the limits, 300 ms after the last key.
  useEffect(() => {
    if (!ask) return;
    let stop = false;
    const t = window.setTimeout(async () => {
      setEstimating(true);
      const q = new URLSearchParams({ kind });
      if (kind === 'bank' && recipient?.bankCode) q.set('bank', recipient.bankCode);
      q.set(ask.side, ask.minor);
      try {
        const res = await api<{ estimate: EstimateDTO; rateLabel: string }>(`/transfers/estimate?${q}`);
        if (stop) return;
        setEstimate(res.estimate);
        setRateLabel(res.rateLabel);
        setEstProblem(null);
        if (kind === 'bank' && ask.side === 'php') {
          const to = BigInt(res.estimate.usdMinor);
          tween(shown.current.usd, to, (v) => {
            shown.current.usd = v;
            setUsdText(typedFromMinor(v.toString(), 6));
          });
        } else if (kind === 'bank' && ask.side === 'usd' && res.estimate.phpMinor) {
          const to = BigInt(res.estimate.phpMinor);
          tween(shown.current.php, to, (v) => {
            shown.current.php = v;
            setPhpText(typedFromMinor(v.toString(), 2));
          });
        }
      } catch (e) {
        if (!stop) setEstProblem(problemOf(e));
      } finally {
        if (!stop) setEstimating(false);
      }
    }, 300);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [ask, kind, recipient?.bankCode, tween]);

  function typed(side: Side, text: string) {
    // A person typing wins over the other field's tween.
    stopTween();
    if (side === 'php') setPhpText(text);
    else setUsdText(text);
    const minor = minorFromTyped(text, side === 'php' ? 2 : 6);
    if (side === 'php') shown.current.php = BigInt(minor ?? 0);
    else shown.current.usd = BigInt(minor ?? 0);
    setAsk(minor ? { side, minor } : null);
    if (!minor) setEstimate(null);
  }

  const name = recipient?.name ?? payee?.name ?? '';
  const short = shortName(name);
  // The estimate for what is typed now (an answer for an earlier amount is not shown as this one's).
  const est = estimate && ask && (ask.side === 'php' ? estimate.phpMinor === ask.minor : estimate.usdMinor === ask.minor) ? estimate : null;
  const limits = est?.limits ?? { perPaymentMinor: company.limits.perPaymentUsdcMinor, dailyMinor: company.limits.dailyUsdcMinor, usedTodayMinor: company.limits.usedTodayUsdcMinor, leftTodayMinor: null, leftAfterMinor: null };
  const rate = est?.rate ?? shell?.rate.rate ?? null;
  const label = rateLabel ?? shell?.rate.label ?? 'test rate';

  const missing = {
    amount: !ask ? 'Type an amount.' : estimating || !est ? WORKING : est.block ? est.block.message : null,
    description: kind === 'bank' && description.trim().length < 3 ? 'Say what was bought, in a few words.' : null,
    relationship: kind === 'bank' && !relationship ? 'Choose how you know them.' : null,
    sourceOfFunds: kind === 'bank' && !sourceOfFunds ? 'Choose where this money comes from.' : null,
  };
  const why = missing.amount ?? missing.description ?? missing.relationship ?? missing.sourceOfFunds;

  const pending = missing.amount === WORKING;
  const submit = useCallback(() => {
    if (!est) return;
    onNext({ phpMinor: est.phpMinor, usdMinor: est.usdMinor, reference: reference.trim(), purpose, description: description.trim(), relationship, sourceOfFunds, note: note.trim() });
  }, [est, onNext, reference, purpose, description, relationship, sourceOfFunds, note]);
  function next() {
    setTried(true);
    if (pending && ask && !(missing.description ?? missing.relationship ?? missing.sourceOfFunds)) {
      setQueued(true);
      return;
    }
    if (why || !est) return;
    submit();
  }
  useEffect(() => {
    if (!queued || pending) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the queued press is used once
    setQueued(false);
    if (!why) submit();
  }, [queued, pending, why, submit]);

  const summary =
    kind === 'bank' ? (
      est?.phpMinor ? (
        <>
          {short} gets <strong>{php(est.phpMinor)}</strong> · about <strong>{usd(est.usdMinor)}</strong> before fees
        </>
      ) : (
        `How much does ${short} get?`
      )
    ) : est ? (
      <>
        {short} gets <strong>{usd(est.usdMinor)}</strong> · no Splash fee
      </>
    ) : (
      `How much are you sending ${short}?`
    );

  return (
    <>
      <div className="iso-split iso-rise iso-rise-2">
        <IsoSurface pad className="iso-split__main iso-stack" aria-labelledby="t2-amount">
          <h2 id="t2-amount" className="iso-h2">
            Amount
          </h2>
          {kind === 'bank' ? (
            <>
              <div className="iso-grid-2 iso-pair">
                <AmountField label="They receive" currency="PHP" value={phpText} onChange={(v) => typed('php', v)} error={tried ? (missing.amount === 'Type an amount.' ? missing.amount : null) : null} />
                <AmountField label="You send, before fees" currency="US$" value={usdText} onChange={(v) => typed('usd', v)} />
              </div>
              {rate ? (
                <p className="iso-small iso-rate">
                  <RefreshCw size={14} aria-hidden="true" /> 1 USD = {rate} PHP · {label} · refreshes when you change either amount
                </p>
              ) : null}
            </>
          ) : (
            <>
              <AmountField label="Amount" currency="US$" value={usdText} onChange={(v) => typed('usd', v)} help="They get exactly this. No Splash fee between Splash businesses." error={tried ? (missing.amount === 'Type an amount.' ? missing.amount : null) : null} />
              <TextField label="Note" value={note} onChange={setNote} maxLength={140} autoComplete="off" help="On both receipts: yours and theirs." />
              <TextField label="Their invoice number (optional)" value={reference} onChange={setReference} maxLength={64} autoComplete="off" spellCheck={false} />
            </>
          )}
          {est?.block ? (
            <p className="iso-note iso-note--danger" role="alert">
              {est.block.message}
            </p>
          ) : null}
          {estProblem ? (
            <p className="iso-note iso-note--danger" role="alert">
              {estProblem.message}
            </p>
          ) : null}
        </IsoSurface>
        <IsoSurface hero pad className="iso-split__side iso-receives" aria-label="What they receive">
          <span className="iso-label">{kind === 'bank' ? 'They receive' : 'Into their Splash account'}</span>
          <span aria-live="polite">
            <IsoDisplay size="lg">{kind === 'bank' ? (est?.phpMinor ? phpWhole(est.phpMinor) : '₱0') : est ? usdWhole(est.usdMinor) : 'US$0'}</IsoDisplay>
          </span>
          <span className="iso-small">
            {kind === 'bank' ? (
              <>
                to {recipient?.bank} <span className="iso-num">•••• {recipient?.accountLast4}</span>
              </>
            ) : (
              <>into {name}’s own Splash account</>
            )}
          </span>
          {kind === 'bank' && est?.rail ? (
            <div className="iso-stack iso-receives__rail">
              <Tag tone="ink">Paid out by {est.rail}</Tag>
              <p className="iso-small" style={{ margin: 0 }}>
                {est.railWhy}
              </p>
            </div>
          ) : null}
        </IsoSurface>
      </div>

      <div className="iso-split iso-rise iso-rise-3">
        {kind === 'bank' ? (
          <IsoSurface pad className="iso-split__main iso-stack" aria-labelledby="t2-for">
            <h2 id="t2-for" className="iso-h2">
              What it’s for
            </h2>
            <TextField label="Reference on their bank statement (optional)" value={reference} onChange={setReference} maxLength={64} autoComplete="off" spellCheck={false} help="An invoice number helps them match it." />
            <div className="iso-field">
              <span className="iso-field__label">Purpose</span>
              <Segmented
                label="Purpose"
                value={purpose}
                onChange={setPurpose}
                options={[
                  { value: 'goods', label: 'Goods' },
                  { value: 'services', label: 'Services' },
                ]}
              />
            </div>
            <TextField label="What was bought" value={description} onChange={setDescription} maxLength={140} autoComplete="off" help={purpose === 'goods' ? 'For example: packaging, 2,000 cartons.' : 'For example: sea freight, October.'} error={tried ? missing.description : null} />
            <div className="iso-grid-2">
              <Combobox label="How you know them" options={(options?.relationships ?? []).map((o) => ({ value: o.value, label: o.label }))} value={relationship} onChange={(v) => setRelationship(v as AmountDraft['relationship'])} placeholder="Choose one" error={tried ? missing.relationship : null} />
              <Combobox label="Where this money comes from" options={(options?.sourcesOfFunds ?? []).map((o) => ({ value: o.value, label: o.label }))} value={sourceOfFunds} onChange={(v) => setSourceOfFunds(v as AmountDraft['sourceOfFunds'])} placeholder="Choose one" error={tried ? missing.sourceOfFunds : null} />
            </div>
            {answers ? <p className="iso-small" style={{ margin: 0 }}>Filled in from your last payment to {short}. Change anything that’s different this time.</p> : null}
          </IsoSurface>
        ) : null}
        <IsoSurface pad className={kind === 'bank' ? 'iso-split__side iso-stack' : 'iso-split__main iso-stack'} aria-labelledby="t2-limits">
          <h2 id="t2-limits" className="iso-h2">
            Your limits
          </h2>
          <dl className="iso-dl iso-dl--rows iso-num">
            <div>
              <dt>Per payment</dt>
              <dd>up to {usd(limits.perPaymentMinor)}</dd>
            </div>
            <div>
              <dt>Used today</dt>
              <dd>
                {usd(limits.usedTodayMinor)} of {usd(limits.dailyMinor)}
              </dd>
            </div>
            <div>
              <dt>After this payment</dt>
              <dd>{limits.leftAfterMinor !== null ? `about ${usd(limits.leftAfterMinor)} left today` : '—'}</dd>
            </div>
          </dl>
          {est ? (
            est.block ? (
              <Tag tone="danger">{est.block.rule === 'per_payment' ? 'Above the per-payment limit' : 'Above today’s limit'}</Tag>
            ) : (
              <Tag tone="ok" tick>
                This payment fits your limits
              </Tag>
            )
          ) : null}
          <p className="iso-small" style={{ margin: 0 }}>
            Fees come on top, on the next step. Every rule is checked again before you approve.
          </p>
        </IsoSurface>
      </div>

      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}

      <ActionBar summary={summary} label="This payment">
        <IsoButton variant="onink" onClick={onBack}>
          Back
        </IsoButton>
        <IsoButton variant="paper" size="lg" onClick={next} busy={busy || queued} disabledReason={tried && why && !queued ? why : null}>
          {busy ? 'Getting the routes…' : kind === 'bank' ? 'See routes and cost' : 'See the cost'}
        </IsoButton>
      </ActionBar>
    </>
  );
}
