/**
 * Build a real .xlsx in memory with no dependencies.
 *
 * An .xlsx is a ZIP of OOXML parts. ZIP permits the STORE method (no
 * compression), which needs only a CRC-32 per entry — and Node ≥ 22.2 ships
 * zlib.crc32. So a spreadsheet the parser under test cannot tell from one
 * saved by Excel costs ~80 lines and zero packages, which matters here: the
 * whole point of the change this covers was removing a parser that installed
 * from a vendor CDN, and re-adding one to write test fixtures would be
 * backwards.
 *
 * Cells are inline strings (t="inlineStr") so no sharedStrings part is
 * needed. A Date is written the way Excel does it — a serial number with a
 * date-formatted style — so the parser's Date handling is exercised for real
 * rather than by feeding it a string that looks like a date.
 */
import { crc32 } from 'node:zlib';

const enc = new TextEncoder();

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const col = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(64 + ((n - 1) % 26) + 1) + s;
  return s;
};

/** Days since 1899-12-30, which is what Excel means by a date. */
const serial = (d) => (d.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000;

function cell(ref, v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return `<c r="${ref}" s="1"><v>${serial(v)}</v></c>`;
  if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(rows) {
  const body = rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(`${col(ci)}${ri + 1}`, v)).join('')}</row>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

const PARTS = (rows) => ({
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Batch" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  // cellXfs[0] is the default; cellXfs[1] is numFmtId 14 — Excel's built-in
  // short date. A numeric cell with s="1" is what makes a reader return a Date.
  'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs>
</styleSheet>`,
  'xl/worksheets/sheet1.xml': sheetXml(rows),
});

/* ── minimal ZIP writer, STORE method ─────────────────────────────────── */

function u16(n) { return [n & 0xff, (n >> 8) & 0xff]; }
function u32(n) { return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]; }

function zipStore(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);

    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ]);
    locals.push(local, data);

    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
      ...nameBytes,
    ]));
    offset += local.length + data.length;
  }

  const centralBytes = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(centralBytes), ...u32(offset), ...u16(0),
  ]);

  const total = offset + centralBytes + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...locals, ...central, eocd]) { out.set(part, p); p += part.length; }
  return out;
}

/**
 * @param {Array<Array<string|number|boolean|Date|null>>} rows  header first
 * @returns {Uint8Array} the bytes of a valid .xlsx
 */
export function makeXlsx(rows) {
  return zipStore(PARTS(rows));
}
