/**
 * The receipt number people read and quote (prompt 12 §5.1): `SPL-R-YYYYMMDD-XXXXXXXX`, the day the
 * receipt was issued in Malaysia time (UTC+8) and the first 8 hex characters of its id, upper case.
 * Display only: the receipt id stays the key for lookup, verify and share.
 */
const RECEIPT_ID = /^rcpt_([0-9a-f]{8})[0-9a-f]{8}$/;
/** Malaysia keeps UTC+8 all year (no daylight saving). */
const MYT_OFFSET_MS = 8 * 3_600_000;

export function receiptNumber(receiptId: string, issuedAt: string): string {
  const id = RECEIPT_ID.exec(receiptId);
  if (!id) throw new Error(`not a receipt id: ${receiptId}`);
  const at = Date.parse(issuedAt);
  if (!Number.isFinite(at)) throw new Error(`not a time: ${issuedAt}`);
  const day = new Date(at + MYT_OFFSET_MS).toISOString().slice(0, 10).replaceAll('-', '');
  return `SPL-R-${day}-${id[1].toUpperCase()}`;
}
