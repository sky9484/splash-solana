/**
 * Supplier rows for a batch payout, from CSV text a person pastes or uploads (prompt 07 §5.5).
 * Pure and import-free, so the browser shows row errors before anything is sent and the server
 * parses the same way.
 *
 * Columns, in any order, with a header (aliases accepted):
 *   supplier   the beneficiary's name
 *   bank       the supplier's bank
 *   account    the account number or its last four digits: only the last four are kept
 *   amount     pesos the supplier receives, e.g. 48,250.00 (integers only from here: centavos)
 *   invoice    optional invoice number
 * Without a header the order above is assumed.
 */

export interface BatchRowInput {
  line: number;
  supplierName: string;
  bank: string;
  accountLast4: string;
  /** Pesos the supplier receives, in centavos. */
  amountPhpMinor: bigint;
  invoiceNumber: string | null;
}

export interface ParsedRows {
  rows: BatchRowInput[];
  errors: Array<{ line: number; message: string }>;
}

/** A batch is chunked on chain; past this a person should split the file. */
export const MAX_BATCH_ROWS = 50;

const ALIASES: Record<'supplier' | 'bank' | 'account' | 'amount' | 'invoice', string[]> = {
  supplier: ['supplier', 'suppliername', 'name', 'beneficiary', 'payee', 'vendor', 'recipient'],
  bank: ['bank', 'bankname', 'suppliersbank'],
  account: ['account', 'accountnumber', 'accountlast4', 'last4', 'accountending', 'acct'],
  amount: ['amount', 'amountphp', 'php', 'pesos', 'pay', 'total'],
  invoice: ['invoice', 'invoiceno', 'invoicenumber', 'reference', 'ref'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** One CSV line into fields: commas, double-quoted fields, and "" inside quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t' || ch === ';') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** "48,250.00", "₱48,250", "PHP 48250.5" → centavos. Null when it is not an amount. No floats. */
export function pesosToCentavos(input: string): bigint | null {
  const t = input.replace(/[₱,\s]|PHP/gi, '');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0'));
}

export function parseSupplierRows(text: string): ParsedRows {
  const lines = text.split(/\r?\n/).map((l, i) => ({ n: i + 1, text: l })).filter((l) => l.text.trim() !== '');
  if (lines.length === 0) return { rows: [], errors: [{ line: 0, message: 'The file has no rows.' }] };
  const first = splitCsvLine(lines[0]!.text).map(norm);
  const column = (key: keyof typeof ALIASES) => first.findIndex((h) => ALIASES[key].includes(h));
  const hasHeader = column('supplier') >= 0 && column('amount') >= 0;
  const at = hasHeader
    ? { supplier: column('supplier'), bank: column('bank'), account: column('account'), amount: column('amount'), invoice: column('invoice') }
    : { supplier: 0, bank: 1, account: 2, amount: 3, invoice: 4 };
  const body = hasHeader ? lines.slice(1) : lines;
  const rows: BatchRowInput[] = [];
  const errors: ParsedRows['errors'] = [];
  for (const { n, text: raw } of body) {
    const f = splitCsvLine(raw);
    const cell = (i: number) => (i >= 0 ? (f[i] ?? '').trim() : '');
    const supplierName = cell(at.supplier);
    const bank = cell(at.bank);
    const digits = cell(at.account).replace(/\D/g, '');
    const amount = pesosToCentavos(cell(at.amount));
    const invoice = cell(at.invoice);
    const problems: string[] = [];
    if (supplierName.length < 2 || supplierName.length > 200) problems.push('a supplier name');
    if (bank.length < 2 || bank.length > 120) problems.push('the supplier’s bank');
    if (digits.length < 4) problems.push('the account number (at least its last 4 digits)');
    if (amount === null || amount <= 0n) problems.push('an amount in pesos, like 48,250.00');
    if (problems.length) {
      errors.push({ line: n, message: `Line ${n} needs ${problems.join(', ')}.` });
      continue;
    }
    rows.push({ line: n, supplierName, bank, accountLast4: digits.slice(-4), amountPhpMinor: amount!, invoiceNumber: invoice ? invoice.slice(0, 64) : null });
  }
  if (rows.length > MAX_BATCH_ROWS) errors.push({ line: 0, message: `A batch can pay up to ${MAX_BATCH_ROWS} suppliers. Split this file into smaller batches.` });
  return { rows, errors };
}

/** Twelve fictional suppliers in the Philippines, for trying a batch offline. */
export const SAMPLE_BATCH_CSV = [
  'supplier,bank,account,amount,invoice',
  'Manila Freight Services Inc.,BDO Unibank,0021-8830-4471,"48,250.00",MFS-1182',
  'Cebu Coco Fibre Trading,Metrobank,3391-0057-2208,"12,400.00",CCF-0331',
  'Davao Packaging Corp.,BPI,8812-3345-0910,"36,980.50",DPC-2207',
  'Iloilo Sugar Mills Supply,Land Bank of the Philippines,5520-1188-7713,"21,150.00",ISM-0419',
  'Batangas Port Logistics,Security Bank,0090-4472-1186,"64,300.00",BPL-7781',
  'Pampanga Steel Fabricators,UnionBank,1022-7781-4450,"18,725.25",PSF-0056',
  'Laguna Precision Parts,China Bank,7745-0912-3368,"9,860.00",LPP-1290',
  'Bacolod Print House,RCBC,4410-6623-0187,"5,200.00",BPH-0915',
  'Zamboanga Marine Supply,PNB,6603-2219-5574,"27,640.00",ZMS-0732',
  'Quezon City Cold Chain,EastWest Bank,3328-5501-9026,"41,075.00",QCC-1443',
  'Baguio Highland Produce,BDO Unibank,0089-1145-6632,"7,315.80",BHP-0288',
  'Subic Bay Container Repair,Metrobank,2276-9034-1158,"15,990.00",SBC-0647',
].join('\n');
