// iso-ui
'use client';

import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';

import { Combobox, IsoButton, Segmented } from '@/components/iso';
import { defaultStatementMonth, monthLabel, statementMonths } from '@/lib/solana-app/months';

type Account = 'payments' | 'treasury' | 'all';
const ACCOUNTS: Array<{ value: Account; label: string }> = [
  { value: 'payments', label: 'Payments' },
  { value: 'treasury', label: 'Treasury' },
  { value: 'all', label: 'All' },
];

/**
 * History's "Monthly statement" (prompt 12 §5.5): a month the company has been on Splash (the last
 * full month to start with) and an account, then the printable statement for them.
 */
export function StatementPicker({ createdAt }: { createdAt: string }) {
  const now = useMemo(() => new Date(), []);
  const months = useMemo(() => statementMonths(createdAt, now).reverse(), [createdAt, now]);
  const [month, setMonth] = useState(() => defaultStatementMonth(createdAt, now));
  const [account, setAccount] = useState<Account>('payments');
  return (
    <section className="iso-surface iso-surface--pad iso-stmtpick" aria-labelledby="stmt-pick">
      <h2 id="stmt-pick" className="iso-h3">
        Monthly statement
      </h2>
      <p className="iso-small">One month of one account, every line with its receipt, ready to print for your accountant.</p>
      <div className="iso-stmtpick__row">
        <Combobox label="Month" options={months.map((m) => ({ value: m, label: monthLabel(m) }))} value={month} onChange={(v) => setMonth(v)} />
        <div className="iso-stmtpick__account">
          <span className="iso-stmtpick__label">Account</span>
          <Segmented label="Account" options={ACCOUNTS} value={account} onChange={setAccount} />
        </div>
        <IsoButton variant="primary" href={`/dashboard/history/statement?month=${month}&account=${account}`}>
          <FileText size={16} aria-hidden="true" /> Open the statement
        </IsoButton>
      </div>
    </section>
  );
}
