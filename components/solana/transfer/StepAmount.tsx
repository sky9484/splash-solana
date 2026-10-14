// iso-ui
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

import { AmountField, Combobox, IsoButton, IsoSurface, Segmented, Tag, TextField } from '@/components/iso';
import { useNavShell } from '@/components/dashboard/useNavShell';

import { api, usd } from '../client';
import type { CompanyDTO } from '../types';
import { SoFar, TxGrid, type SoFarRow } from './SoFar';
import { minorFromTyped, phpWhole, problemOf, shortName, typedFromMinor, type AmountDraft, type DetailsOptions, type EstimateDTO, type Payee, type Problem, type RecipientRow } from './shared';

type Side = 'php' | 'usd';
const WORKING = 'Working out the other amount…';
type Ask = { side: Side; minor: string } | null;

/** A checked invoice from this recipient, ready to pay (GET /api/solana/invoices?view=ready). */
export interface ReadyBill {
  id: string;
  number: string;
  supplier: string;
  bank: string;
  /** The bank's code (BDO), when the invoice's bank name is one the payout partner knows. */
  bankCode: string | null;
  last4: string;
  amountPhpMinor: string;
}

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
 * Step 2, "How much?" then "What it's for" (prompt 11 §2.3; prompt 10 §5.5).
 *
 *   bank   "They receive" in PHP and "You send, before fees" in US$, coupled: typing either asks the
 *          server for the other about 300 ms after the last key, at the partner's rate, and names the
 *          rail. A checked invoice from this recipient, ready to pay, offers itself as a chip: it opens
 *          that invoice's own payment, so it is never paid twice. What it's for: a reference, Goods or
 *          Services and what was bought, and the two questions the partner asks of every transfer.
 *   peer   the amount in US$, a note that goes on both receipts, and their invoice number.
 *
 * So far carries the limits: per payment, what's left today after this, a bar, and whether it fits.
 * An amount above a limit is stopped here with the rule's name. The exact cost is the next step's quote.
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
  rows,
  onEstimate,
  onUseBill,
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
  rows: SoFarRow[];
  /** The server's estimate for what is typed now (the header's figures), or null. */
  onEstimate: (e: EstimateDTO | null) => void;
  onUseBill: (billId: string) => void;
  /** Back to step 1, with what was typed so far, so coming back to this recipient keeps it. */
  onBack: (kept: AmountDraft) => void;
  onNext: (d: AmountDraft) => void;
}) {
  const shell = useNavShell();
  const { run: tween, cancel: stopTween } = useTween();
  const answers = recipient?.lastAnswers ?? null;
  const [phpText, setPhpText] = useState(() => typedFromMinor(draft?.phpMinor ?? null, 2));
  const [usdText, setUsdText] = useState(() => typedFromMinor(draft?.usdMinor ?? null, 6));
  // A kept draft from going back may have no amount yet: then nothing is asked for.
  const [ask, setAsk] = useState<Ask>(() => (draft ? (kind === 'bank' && draft.phpMinor ? { side: 'php', minor: draft.phpMinor } : draft.usdMinor && BigInt(draft.usdMinor) > 0n ? { side: 'usd', minor: draft.usdMinor } : null) : null));
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
  const [bills, setBills] = useState<ReadyBill[]>([]);
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

  // A checked invoice from this recipient, ready to pay: offered as a chip (a read; nothing is marked).
  useEffect(() => {
    if (kind !== 'bank' || !recipient) return;
    let stop = false;
    api<{ bills: ReadyBill[] }>('/invoices?view=ready')
      .then((r) => {
        if (stop) return;
        const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
        // The invoice prints "BDO Unibank, Inc.", a saved recipient says "BDO Unibank": compare the bank codes when both have one.
        const sameBank = (b: ReadyBill) => (b.bankCode && recipient.bankCode ? b.bankCode === recipient.bankCode : same(b.bank, recipient.bank));
        setBills(r.bills.filter((b) => same(b.supplier, recipient.name) && sameBank(b) && b.last4 === recipient.accountLast4));
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [kind, recipient]);

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
  useEffect(() => {
    onEstimate(est);
  }, [est, onEstimate]);
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

  // The limits box: per payment, what's left today after this, and the day's use as a bar.
  const daily = BigInt(limits.dailyMinor);
  const usedAfter = BigInt(limits.usedTodayMinor) + (est ? BigInt(est.usdMinor) : 0n);
  const fillPct = daily === 0n ? 0 : Number(usedAfter >= daily ? 100n : (usedAfter * 100n) / daily);
  const leftAfter = est ? BigInt(est.limits.leftAfterMinor) : daily - BigInt(limits.usedTodayMinor);

  const main = (
    <>
      <IsoSurface pad className="iso-stack" aria-labelledby="t2-amount">
        <h2 id="t2-amount" className="iso-h2" data-step-heading>
          How much?
        </h2>
        {kind === 'bank' ? (
          <>
            <div className="iso-grid-2 iso-pair">
              <AmountField label="They receive" currency="PHP" value={phpText} onChange={(v) => typed('php', v)} error={tried ? (missing.amount === 'Type an amount.' ? missing.amount : null) : null} />
              <AmountField label="You send, before fees" currency="US$" value={usdText} onChange={(v) => typed('usd', v)} />
            </div>
            <div className="iso-row" style={{ justifyContent: 'space-between' }}>
              {rate ? (
                <p className="iso-small iso-rate">
                  <RefreshCw size={14} aria-hidden="true" /> 1 USD = {rate} PHP · {label} · refreshes when you change either amount
                </p>
              ) : (
                <span />
              )}
              {bills.slice(0, 1).map((b) => (
                <button key={b.id} type="button" className="iso-chip" onClick={() => onUseBill(b.id)}>
                  Use invoice <span className="iso-mono">&nbsp;{b.number}&nbsp;</span> · {phpWhole(b.amountPhpMinor)}
                </button>
              ))}
            </div>
            {est?.railWhy ? (
              <p className="iso-small" style={{ margin: 0 }}>
                {est.railWhy}
              </p>
            ) : null}
          </>
        ) : (
          <AmountField label="Amount" currency="US$" value={usdText} onChange={(v) => typed('usd', v)} help="They get exactly this. No Splash fee between Splash businesses." error={tried ? (missing.amount === 'Type an amount.' ? missing.amount : null) : null} />
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

      <IsoSurface pad className="iso-stack" aria-labelledby="t2-for">
        <h2 id="t2-for" className="iso-h2">
          What it’s for
        </h2>
        {kind === 'bank' ? (
          <>
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
          </>
        ) : (
          <>
            <TextField label="Note" value={note} onChange={setNote} maxLength={140} autoComplete="off" help="On both receipts: yours and theirs." />
            <TextField label="Their invoice number (optional)" value={reference} onChange={setReference} maxLength={64} autoComplete="off" spellCheck={false} />
          </>
        )}
      </IsoSurface>

      {problem ? (
        <p className="iso-note iso-note--danger" role="alert">
          {problem.message}
        </p>
      ) : null}
    </>
  );

  const limitsBox = (
    <div className="iso-limits" aria-label="Your limits">
      <dl className="iso-dl iso-dl--rows iso-num">
        <div>
          <dt>Per payment</dt>
          <dd>up to {usd(limits.perPaymentMinor)}</dd>
        </div>
        <div>
          <dt>Left today after this</dt>
          <dd>{est ? `about ${usd(leftAfter < 0n ? 0n : leftAfter)}` : usd(leftAfter < 0n ? 0n : leftAfter)}</dd>
        </div>
      </dl>
      <div className="iso-limits__bar" role="img" aria-label={`Used today${est ? ', with this payment' : ''}: ${usd(usedAfter)} of ${usd(daily)}`}>
        <span style={{ width: `${fillPct}%` }} />
      </div>
      {est ? (
        est.block ? (
          <Tag tone="danger">{est.block.rule === 'per_payment' ? 'Above the per-payment limit' : 'Above today’s limit'}</Tag>
        ) : (
          <Tag tone="ok" tick>
            Fits your rules
          </Tag>
        )
      ) : null}
      <p className="iso-small" style={{ margin: 0 }}>
        {kind === 'peer' ? 'No Splash fee between Splash businesses.' : 'Fees come on top, on the next step.'} Every rule is checked again before you approve.
      </p>
    </div>
  );

  return (
    <TxGrid
      main={main}
      rail={
        <SoFar
          rows={rows}
          extra={limitsBox}
          action={
            <IsoButton variant="primary" size="lg" block onClick={next} busy={busy || queued} disabledReason={tried && why && !queued ? why : null}>
              {busy ? 'Getting the routes…' : 'See routes and cost'}
            </IsoButton>
          }
          back={{
            label: 'Back to recipient',
            onClick: () =>
              onBack({
                phpMinor: est?.phpMinor ?? (ask?.side === 'php' ? ask.minor : null),
                usdMinor: est?.usdMinor ?? (ask?.side === 'usd' ? ask.minor : ''),
                reference,
                purpose,
                description,
                relationship,
                sourceOfFunds,
                note,
              }),
          }}
        />
      }
    />
  );
}
