// iso-ui
'use client';

import { useId, useRef, type ClipboardEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import clsx from 'clsx';

type Ids = { id: string; describedBy: string | undefined; invalid: boolean };

/**
 * A field (§2.3): 56 px, square, the label above, and the help or the error in the same slot under
 * it, so the layout doesn't jump when an error appears. No native <select> anywhere: a choice is a
 * Combobox or a Segmented control.
 */
export function Field({ label, help, error, id: given, className, children }: { label: ReactNode; help?: ReactNode; error?: string | null; id?: string; className?: string; children: (ids: Ids) => ReactNode }) {
  const auto = useId();
  const id = given ?? auto;
  const slotId = `${id}-slot`;
  const hasSlot = Boolean(error || help);
  return (
    <div className={clsx('iso-field', className)}>
      <label className="iso-field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy: hasSlot ? slotId : undefined, invalid: Boolean(error) })}
      {error ? (
        <span id={slotId} className="iso-field__error" role="alert">
          {error}
        </span>
      ) : help ? (
        <span id={slotId} className="iso-field__help">
          {help}
        </span>
      ) : null}
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'className'>;

export function TextField({ label, help, error, value, onChange, end, ...rest }: InputProps & { label: ReactNode; help?: ReactNode; error?: string | null; value: string; onChange: (v: string) => void; end?: ReactNode }) {
  return (
    <Field label={label} help={help} error={error} id={rest.id}>
      {({ id, describedBy, invalid }) => (
        <div className={clsx('iso-field__control', invalid && 'iso-field__control--invalid')}>
          <input {...rest} id={id} className="iso-field__input" value={value} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
          {end}
        </div>
      )}
    </Field>
  );
}

/**
 * An amount: tabular digits and a currency chip. The value stays the text a person typed (digits and
 * one decimal point, at most two decimals); the caller turns it into integer minor units.
 */
export function AmountField({ label, currency, help, error, value, onChange, ...rest }: InputProps & { label: ReactNode; currency: string; help?: ReactNode; error?: string | null; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} help={help} error={error} id={rest.id} className="iso-amount">
      {({ id, describedBy, invalid }) => (
        <div className={clsx('iso-field__control', invalid && 'iso-field__control--invalid')}>
          <span className="iso-currency" aria-hidden="true">
            {currency}
          </span>
          <input
            {...rest}
            id={id}
            className="iso-field__input"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange(cleanAmount(e.target.value))}
          />
        </div>
      )}
    </Field>
  );
}

/** Digits with thousands commas and one decimal point, at most two decimals. */
export function cleanAmount(raw: string): string {
  const s = raw.replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  const whole = (dot === -1 ? s : s.slice(0, dot)).replace(/^0+(?=\d)/, '');
  const frac = dot === -1 ? null : s.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === null ? grouped : `${grouped || '0'}.${frac}`;
}

/** "1234567890123" grouped by the bank's pattern ([4, 4, 4] by default; the rest in fours). */
export function groupDigits(digits: string, groups: number[] = [4, 4, 4]): string {
  const out: string[] = [];
  let i = 0;
  for (const g of groups) {
    if (i >= digits.length) break;
    out.push(digits.slice(i, i + g));
    i += g;
  }
  while (i < digits.length) {
    out.push(digits.slice(i, i + 4));
    i += 4;
  }
  return out.join(' ');
}

/**
 * A full account number, typed (§5.3): grouped as the bank writes it, digits only. The second entry
 * blocks paste (`noPaste`), and `match` shows a tick when both entries agree. It never stores or
 * logs the number itself; the caller hands it straight to the server.
 */
export function MaskedField({
  label,
  help,
  error,
  value,
  onChange,
  groups,
  maxDigits = 20,
  noPaste = false,
  pasteMessage = 'Type it again rather than pasting, so a slip in the first entry is caught.',
  match = false,
  onPasteBlocked,
  ...rest
}: InputProps & {
  label: ReactNode;
  help?: ReactNode;
  error?: string | null;
  value: string;
  onChange: (digits: string) => void;
  groups?: number[];
  maxDigits?: number;
  noPaste?: boolean;
  pasteMessage?: string;
  match?: boolean;
  onPasteBlocked?: (message: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Field label={label} help={help} error={error} id={rest.id} className="iso-masked">
      {({ id, describedBy, invalid }) => (
        <div className={clsx('iso-field__control', invalid && 'iso-field__control--invalid', match && 'iso-field__control--ok')}>
          <input
            {...rest}
            ref={ref}
            id={id}
            className="iso-field__input"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={groupDigits(value, groups)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onPaste={
              noPaste
                ? (e: ClipboardEvent<HTMLInputElement>) => {
                    e.preventDefault();
                    onPasteBlocked?.(pasteMessage);
                  }
                : undefined
            }
            onChange={(e) => {
              const el = e.target;
              // Keep the caret after the same number of digits it was after.
              const caret = el.selectionStart ?? el.value.length;
              const digitsBefore = el.value.slice(0, caret).replace(/\D/g, '').length;
              const digits = el.value.replace(/\D/g, '').slice(0, maxDigits);
              onChange(digits);
              requestAnimationFrame(() => {
                const node = ref.current;
                if (!node || document.activeElement !== node) return;
                let seen = 0;
                let pos = 0;
                while (pos < node.value.length && seen < digitsBefore) {
                  if (/\d/.test(node.value[pos])) seen += 1;
                  pos += 1;
                }
                node.setSelectionRange(pos, pos);
              });
            }}
          />
          {match ? (
            <span className="iso-field__okmark" role="img" aria-label="Both entries match">
              <Check size={20} strokeWidth={3} />
            </span>
          ) : null}
        </div>
      )}
    </Field>
  );
}
