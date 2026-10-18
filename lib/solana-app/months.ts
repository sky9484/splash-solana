/**
 * Statement months (prompt 12 §5.5), in Malaysia time (UTC+8, no daylight saving). Pure: the History
 * picker in the browser and the statement on the server use the same months.
 */
const MYT_MS = 8 * 3_600_000;
const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** YYYY-MM of a moment, in Malaysia time. */
export const mytMonth = (iso: string) => new Date(Date.parse(iso) + MYT_MS).toISOString().slice(0, 7);

/** The first moment of a Malaysia-time month, in UTC milliseconds. */
export function monthStart(month: string): number {
  return Date.parse(`${month}-01T00:00:00Z`) - MYT_MS;
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map((v) => Number.parseInt(v, 10));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** "October 2026". A name from the month number, not a date format. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map((v) => Number.parseInt(v, 10));
  return `${NAMES[m - 1]} ${y}`;
}

/** The months a company can have a statement for: from the month it was created to this month. */
export function statementMonths(createdAt: string, now: Date): string[] {
  const out: string[] = [];
  const last = mytMonth(now.toISOString());
  for (let m = mytMonth(createdAt); m <= last; m = nextMonth(m)) out.push(m);
  return out;
}

/** The default month: the last full month, or the company's first month when it is younger than that. */
export function defaultStatementMonth(createdAt: string, now: Date): string {
  const months = statementMonths(createdAt, now);
  return months.length > 1 ? months[months.length - 2] : months[0];
}
