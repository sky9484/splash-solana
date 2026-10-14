/**
 * The invoice as "Check the invoice" shows it (prompt 10 §6.2): its lines, numbered, with the bank
 * account number masked in the document too. The full number is taken out here, once, to be sealed
 * (invoice-number.ts); nothing that leaves the server carries it.
 *
 * Integers only: amounts are read into centavos with string and bigint math, never a float.
 */
import { PH_BANKS } from '../solana-partner/banks.ts';
import type { ReaderOutput } from '../solana-zeke/reader.ts';

const MASK = '•••• ••••';

/** "0021-8830-4471" → "002188304471". */
const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Digit runs that may be split by spaces or dashes ("0021-8830-4471", "4402 1188 2290"). */
const RUN = /\d[\d -]*\d/g;

const ACCOUNT_LINE = /\b(?:account|acct|a\/c)\b/i;

/**
 * The full account number printed on the invoice: on the line the reader found the account on (or,
 * when it gave no line, on a line that says "account"), the digit run of 6 to 20 digits that ends in
 * the last four the reader extracted. Null when the invoice shows only the last four, or none.
 */
export function accountNumberFrom(text: string, draft: Pick<ReaderOutput, 'fields' | 'sources'>): string | null {
  const last4 = draft.fields.supplierAccountLast4;
  if (!/^\d{4}$/.test(last4 ?? '')) return null;
  const lines = text.split(/\r?\n/);
  const at = draft.sources.supplierAccountLast4?.line ?? null;
  const candidates = at && lines[at - 1] !== undefined ? [lines[at - 1]!] : lines.filter((l) => ACCOUNT_LINE.test(l));
  for (const line of candidates) {
    for (const m of line.match(RUN) ?? []) {
      const d = digitsOf(m);
      if (d.length >= 6 && d.length <= 20 && d.endsWith(last4)) return d;
    }
  }
  return null;
}

/** "•••• •••• 4471": how the account number reads everywhere it is masked. */
export const maskedAccount = (last4: string) => `${MASK} ${last4}`;

/**
 * The document's lines with every printing of the account number masked ("Account Number: •••• ••••
 * 4471"). Other numbers (a tax number, a phone number, the amounts) stay as printed.
 */
export function maskedLines(text: string, accountNumber: string | null): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  // A trailing newline is not a line of the document.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  if (!accountNumber) return lines;
  const last4 = accountNumber.slice(-4);
  return lines.map((l) => l.replace(RUN, (m) => (digitsOf(m) === accountNumber ? maskedAccount(last4) : m)));
}

/** "₱86,400.00", "PHP 12,000.00", "86400.00" at the end of a line → centavos. Null when the line ends in no amount. */
export function lineAmountMinor(line: string): bigint | null {
  const m = /(?:₱|PHP)?\s*(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\s*$/.exec(line);
  if (!m) return null;
  return BigInt(m[1]!.replace(/,/g, '')) * 100n + BigInt(m[2]!);
}

/**
 * Whether the item lines above the total add up to it: walking up from the total's line, the
 * consecutive lines that end in an amount (blank lines between them allowed). Null when there are
 * fewer than two such lines, so there is nothing to check.
 */
export function itemsCheck(lines: readonly string[], totalLine: number | null, totalMinor: bigint): { count: number; sumMinor: bigint; matches: boolean } | null {
  if (!totalLine || totalLine < 2) return null;
  let count = 0;
  let sum = 0n;
  for (let i = totalLine - 2; i >= 0; i--) {
    const l = lines[i] ?? '';
    if (l.trim() === '') {
      if (count > 0) break;
      continue;
    }
    const v = lineAmountMinor(l);
    if (v === null) break;
    count++;
    sum += v;
  }
  if (count < 2) return null;
  return { count, sumMinor: sum, matches: sum === totalMinor };
}

/** The payout partner's code for a bank as an invoice prints it ("BDO Unibank, Inc." → BDO). Null when it isn't on the list. */
export function bankCodeFor(name: string): string | null {
  const n = name.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const b of PH_BANKS) {
    const bn = b.name.toLowerCase();
    if (n === b.code.toLowerCase() || n === bn || n.startsWith(`${bn} `) || n.startsWith(`${b.code.toLowerCase()} `)) return b.code;
  }
  return null;
}

/** Whether a phone number someone called is printed in the document (then it isn't a number "from your records"). */
export function numberIsInDocument(lines: readonly string[], phone: string): boolean {
  const want = digitsOf(phone);
  if (want.length < 6) return false;
  // Compare the last 8 digits so "+63 32 345 6789" and "(032) 345-6789" are the same number.
  const tail = want.slice(-8);
  return lines.some((l) => (l.match(RUN) ?? []).some((m) => digitsOf(m).endsWith(tail)));
}
