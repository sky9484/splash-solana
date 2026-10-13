// Splash Iso UI (prompt 10 §2.5): the redesigned files keep to look 9. Checked: everything under
// components/iso/**, styles/iso-ui.css, and any file a phase rebuilt (its first line is `// iso-ui`,
// or `/* iso-ui` in CSS). In those files it fails on:
//   - a blurred shadow (box-shadow / boxShadow with a blur radius, Tailwind shadow-*, drop-shadow,
//     a blur() filter): look 9's only elevation is a solid offset ledge;
//   - a native <select>: a choice is a Combobox or a Segmented control;
//   - a colour that isn't a token: a hex or an rgb() whose colour isn't in the `.iso` block of
//     styles/tokens.css;
//   - more extruded displays (`iso-display` / <IsoDisplay>) than the file has visible states: one
//     per state; a file with several states declares `// iso-ui states: N`. The Invoices chooser is
//     the one exception (two titles, one state): `// iso-ui display-exception: chooser`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const TOKENS = 'styles/tokens.css';
const SCAN = ['app', 'components', 'styles'];

function walk(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((n) => walk(join(path, n).replaceAll('\\', '/')));
}

function hexToRgb(hex) {
  let h = hex.replace('#', '').toLowerCase();
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)].join(',');
}

/** The colours look 9 may use: every hex and rgb() in the `.iso { … }` token block. */
export function tokenColours(css = readFileSync(TOKENS, 'utf8')) {
  const start = css.indexOf('\n.iso {');
  if (start === -1) throw new Error('styles/tokens.css has no `.iso { … }` block');
  const block = css.slice(start, css.indexOf('\n}', start));
  const rgb = new Set();
  for (const m of block.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) rgb.add(hexToRgb(m[0]));
  for (const m of block.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) rgb.add(`${m[1]},${m[2]},${m[3]}`);
  return rgb;
}

const stripComments = (text, css) =>
  css ? text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')) : text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** A box-shadow value with a non-zero blur: the third length of any comma-separated shadow. */
function blurredShadow(value) {
  for (const part of value.split(/,(?![^(]*\))/)) {
    const lengths = [...part.matchAll(/(-?\d*\.?\d+)(px|rem|em)?\b/g)].map((m) => Number(m[1]));
    if (/\binset\b/.test(part) && lengths.length >= 3 && lengths[2] !== 0) return true;
    if (lengths.length >= 3 && lengths[2] !== 0) return true;
  }
  return false;
}

export function findings(file, raw, colours) {
  const css = extname(file) === '.css';
  const text = stripComments(raw, css);
  const out = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    for (const m of line.matchAll(/box-shadow\s*:\s*([^;}{]+)/gi)) {
      const v = m[1].replace(/var\(--[\w-]+\)/g, '').trim();
      if (v && !/^none\b/i.test(v) && blurredShadow(v)) out.push(`${at} blurred shadow: ${m[0].trim()}`);
    }
    for (const m of line.matchAll(/boxShadow\s*:\s*['"`]([^'"`]+)['"`]/g)) if (blurredShadow(m[1])) out.push(`${at} blurred shadow: ${m[0]}`);
    if (/(?:^|[\s"'`])(?:shadow|shadow-(?:sm|md|lg|xl|2xl|inner))(?=[\s"'`]|$)/.test(line) && !css) out.push(`${at} a blurred Tailwind shadow class`);
    if (/drop-shadow|filter\s*:\s*[^;]*blur\(|backdrop-blur|backdrop-filter/i.test(line)) out.push(`${at} a blur: ${line.trim().slice(0, 80)}`);
    if (!css && /<select[\s>]/.test(line)) out.push(`${at} a native <select>`);
    for (const m of line.matchAll(/(?<![\w&-])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)) {
      if (!colours.has(hexToRgb(m[0]))) out.push(`${at} a colour that isn't a token: ${m[0]}`);
    }
    for (const m of line.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
      if (!colours.has(`${m[1]},${m[2]},${m[3]}`)) out.push(`${at} a colour that isn't a token: ${m[0]})`);
    }
  });
  if (!css) {
    const displays = (text.match(/<IsoDisplay\b/g) ?? []).length + (text.match(/['"`\s]iso-display(?:['"`\s])/g) ?? []).length;
    const declared = Number(/\/\/\s*iso-ui states:\s*(\d+)/.exec(raw)?.[1] ?? 1);
    const chooser = /\/\/\s*iso-ui display-exception:\s*chooser/.test(raw);
    const allowed = chooser ? 2 : declared;
    if (displays > allowed) out.push(`${file} has ${displays} extruded displays for ${allowed} visible state(s); one per state (declare \`// iso-ui states: N\` for a file with several states)`);
  }
  return out;
}

export function redesignedFiles() {
  const marked = SCAN.flatMap(walk).filter((f) => {
    if (!['.ts', '.tsx', '.css'].includes(extname(f))) return false;
    if (f.startsWith('components/iso/') || f === 'styles/iso-ui.css') return true;
    const head = readFileSync(f, 'utf8').split('\n', 1)[0].trim();
    return head === '// iso-ui' || head.startsWith('/* iso-ui');
  });
  return [...new Set(marked)].sort();
}

const isMain = process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/check-iso-ui.mjs');
if (isMain) {
  const colours = tokenColours();
  const files = redesignedFiles();
  const found = files.flatMap((f) => findings(f, readFileSync(f, 'utf8'), colours));
  if (found.length) {
    console.error(`check-iso-ui: ${found.length} problem(s) in the redesigned files:`);
    for (const f of found) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`check-iso-ui: ${files.length} redesigned files keep to look 9.`);
}
