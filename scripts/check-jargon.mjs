// Plain language (prompt 10 §0.6): count the crypto words in what a customer reads on the dashboard,
// and fail when the count goes up. The terms live in lib/copy/jargon.ts.
//
// What is read: JSX text and the string literals that can reach a screen (aria-label, title,
// placeholder and alt included), in the files the customer dashboard renders, plus the label maps in
// lib/** that §0.5 names (POLICY_LABEL, the router's LABEL, FUNDING_METHODS, the partner registry's
// display names). What is not: comments, import paths, class names, hrefs and other attribute plumbing,
// strings compared against (`state === 'anchored'`), object keys, types, and single lowercase
// identifiers. Files under components/technical/** or marked `// copy: technical` are the allowed
// zones (the crypto-wallet sheet, "How it moves", "Technical details", Settings › Account details).
//
//   node --experimental-strip-types scripts/check-jargon.mjs            check against the recorded count
//   node --experimental-strip-types scripts/check-jargon.mjs --report   per-file and per-term counts
//   node --experimental-strip-types scripts/check-jargon.mjs --write    record the current count (a phase lowers it)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import ts from 'typescript';

import { jargonIn } from '../lib/copy/jargon.ts';

const BASELINE = 'docs/design/jargon-baseline.json';
/** `--root=<dir>` scans another checkout (the baseline is measured on a clean tree). */
const ROOT = process.argv.find((a) => a.startsWith('--root='))?.slice(7) ?? '.';
const slash = (p) => p.replaceAll('\\', '/');
const at = (p) => (ROOT === '.' ? p : slash(join(ROOT, p)));
const rel = (p) => (ROOT === '.' ? p : slash(p).slice(slash(join(ROOT, '/')).length));

const ROOTS = [
  'app/dashboard',
  'app/pay',
  'app/receipt',
  'components/solana',
  'components/iso',
  'components/dashboard',
  'components/approvals',
  'components/pay',
  'components/setup',
  'components/onboarding',
  'components/settings',
  'components/StatusBadge.tsx',
];

/** §0.5: other surfaces, or legacy code prompt 10 doesn't touch. */
const EXCLUDED = [
  'components/IsometricLanding.tsx',
  'components/mobile/',
  'app/admin/',
  'components/oxwal/',
  'components/funding/FundingSelector.tsx',
  'components/transfer/',
  'app/api/funding/options/',
  'lib/server/',
  'lib/funding/',
  'lib/env.ts',
  'components/dashboard/SettlementEngineFlow.tsx',
  'components/technical/',
];

/** The label maps in lib/** that reach a screen: file → the declarations (or property names) read. */
const LABEL_MAPS = [
  { file: 'lib/solana-app/service.ts', vars: ['POLICY_LABEL'] },
  { file: 'lib/solana-zeke/router.ts', vars: ['LABEL'] },
  { file: 'lib/solana-app/funding-service.ts', vars: ['FUNDING_METHODS'] },
  { file: 'lib/solana-partner/registry.ts', props: ['name', 'displayName', 'label'] },
];

/** Attributes and properties that carry plumbing, not words. */
const PLUMBING = new Set([
  'className', 'class', 'href', 'src', 'id', 'key', 'type', 'role', 'rel', 'target', 'htmlFor', 'name', 'as', 'variant', 'tone', 'size',
  'kind', 'layoutId', 'method', 'inputMode', 'autoComplete', 'pattern', 'viewBox', 'd', 'fill', 'stroke', 'strokeWidth', 'strokeLinecap',
  'strokeLinejoin', 'transform', 'xmlns', 'path', 'icon', 'mode', 'state', 'code', 'status', 'cluster', 'lane', 'policy', 'purpose', 'step',
  'tab', 'value', 'defaultValue', 'sizes', 'priority', 'loading', 'decoding', 'encType', 'accept', 'dir', 'lang', 'form', 'scope',
  'aria-hidden', 'aria-current', 'aria-live', 'aria-controls', 'aria-describedby', 'aria-labelledby', 'aria-expanded', 'aria-pressed',
  'aria-checked', 'aria-selected', 'aria-haspopup', 'aria-autocomplete', 'aria-activedescendant', 'aria-invalid', 'aria-modal', 'data-testid',
  'style', 'objectFit', 'background', 'color', 'border', 'boxShadow', 'fontFamily', 'font', 'display', 'cursor', 'width', 'height',
  'redirect', 'route', 'url', 'endpoint', 'storageKey', 'event', 'eventName', 'testId', 'glyph', 'coin',
]);

function walk(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((n) => walk(join(path, n).replaceAll('\\', '/')));
}

const isCode = (f) => ['.ts', '.tsx', '.mjs', '.js', '.jsx'].includes(extname(f));
const excluded = (f) => EXCLUDED.some((e) => (e.endsWith('/') ? f.startsWith(e) : f === e));
const technical = (text) => /^\s*\/\/\s*copy:\s*technical\b/m.test(text.split('\n').slice(0, 5).join('\n'));

/** A string a person could read: has a letter, and isn't a lone identifier, path, URL or CSS. */
function readable(s) {
  const t = s.trim();
  if (!/[A-Za-z]/.test(t)) return false;
  if (/^(?:\/|\.\/|\.\.\/|@\/|https?:|mailto:|#|var\(|rgb|data:|[\w-]+\.(?:png|svg|webp|jpg|css|json|tsx?|mjs))/.test(t)) return false;
  if (!/\s/.test(t)) {
    // One word: a label if it starts with a capital or is all caps ("Vault", "USDC"); otherwise an identifier.
    if (/[_./:=]/.test(t)) return false;
    if (!/^[A-Z]/.test(t)) return false;
  }
  // A Tailwind or CSS class list.
  if (/^(?:[\w:[\]/.#%()-]+\s+)*[\w:[\]/.#%()-]+$/.test(t) && /(?:^|\s)(?:flex|grid|text-|bg-|px-|py-|mt-|mb-|rounded|border|iso-|sx-|w-|h-|gap-|items-|justify-)/.test(t)) return false;
  return true;
}

function attrName(node) {
  let p = node.parent;
  if (p && ts.isJsxExpression(p)) p = p.parent;
  if (p && ts.isJsxAttribute(p)) return p.name.getText();
  return null;
}

function skipLiteral(node) {
  const p = node.parent;
  if (!p) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isPropertyAssignment(p) && PLUMBING.has(p.name.getText().replace(/['"]/g, ''))) return true;
  if (ts.isElementAccessExpression(p)) return true;
  if (ts.isCaseClause(p)) return true;
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return true;
  if (ts.isCallExpression(p)) {
    const callee = p.expression.getText();
    if (/(?:^|\.)(?:includes|startsWith|endsWith|get|has|getItem|setItem|querySelector(?:All)?|addEventListener|removeEventListener|dispatchEvent|matchMedia|push|replace|api|fetch|require|split|join|test|match|padStart|toLocaleString|localeCompare)$/.test(callee)) return true;
    if (/^(?:new )?(?:Event|CustomEvent|URLSearchParams|RegExp|Error|Set|Map)$/.test(callee)) return true;
  }
  if (ts.isNewExpression(p) && /^(?:Event|CustomEvent|URLSearchParams|RegExp|Set|Map)$/.test(p.expression.getText())) return true;
  const attr = attrName(node);
  if (attr && (PLUMBING.has(attr) || attr.startsWith('data-') || attr.startsWith('on'))) return true;
  return false;
}

/** The readable strings in a source file (or only inside the named declarations / properties). */
function strings(file, text, only) {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : file.endsWith('.mjs') || file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const visit = (node, inScope) => {
    let scope = inScope;
    if (only?.vars && ts.isVariableDeclaration(node) && only.vars.includes(node.name.getText())) scope = true;
    if (only?.props && ts.isPropertyAssignment(node) && only.props.includes(node.name.getText())) scope = true;
    if (scope) {
      if (ts.isJsxText(node)) {
        const t = node.getText().replace(/\s+/g, ' ').trim();
        if (t && /[A-Za-z]/.test(t)) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: t });
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (!skipLiteral(node) && readable(node.text)) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: node.text });
      } else if (ts.isTemplateExpression(node)) {
        if (!skipLiteral(node)) {
          const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' … ');
          if (readable(parts)) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: parts });
        }
      }
    }
    ts.forEachChild(node, (c) => visit(c, scope));
  };
  visit(sf, !only);
  return out;
}

export function scan() {
  const files = ROOTS.map(at).flatMap(walk).map(rel).filter((f) => isCode(f) && !excluded(f));
  const hits = [];
  for (const f of files) {
    const text = readFileSync(at(f), 'utf8');
    if (technical(text)) continue;
    for (const s of strings(f, text)) for (const h of jargonIn(s.text)) hits.push({ file: f, line: s.line, ...h, text: s.text });
  }
  for (const m of LABEL_MAPS) {
    const text = readFileSync(at(m.file), 'utf8');
    for (const s of strings(m.file, text, m)) for (const h of jargonIn(s.text)) hits.push({ file: m.file, line: s.line, ...h, text: s.text });
  }
  return { files: files.length, hits };
}

function tally(hits, key) {
  const t = {};
  for (const h of hits) t[h[key]] = (t[h[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop());
if (isMain) {
  const { files, hits } = scan();
  const count = hits.length;
  const recorded = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
  const args = new Set(process.argv.slice(2));

  if (args.has('--report')) {
    console.log(`Jargon hits: ${count} in ${files} files`);
    console.log('By term:', tally(hits, 'term'));
    console.log('By file:', tally(hits, 'file'));
    if (args.has('--lines')) for (const h of hits) console.log(`  ${h.file}:${h.line} [${h.match}] ${h.text.slice(0, 100)}`);
  }

  if (args.has('--write')) {
    const phase = [...args].find((a) => a.startsWith('--phase='))?.slice(8) ?? 'unnamed';
    const next = recorded
      ? { ...recorded, current: count, history: [...recorded.history, { phase, count, date: new Date().toISOString().slice(0, 10) }] }
      : { baseline: count, current: count, targetMax: Math.floor(count * 0.15), history: [{ phase, count, date: new Date().toISOString().slice(0, 10) }], byTerm: tally(hits, 'term') };
    if (recorded && count > recorded.current) {
      console.error(`check-jargon: ${count} is above the recorded ${recorded.current}; a phase may only lower it.`);
      process.exit(1);
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`check-jargon: recorded ${count} (baseline ${next.baseline}, target at most ${next.targetMax}).`);
    process.exit(0);
  }

  if (!recorded) {
    console.error(`check-jargon: no ${BASELINE}. Record the baseline with --write.`);
    process.exit(1);
  }
  if (count > recorded.current) {
    console.error(`check-jargon: ${count} crypto words in customer copy, above the recorded ${recorded.current} (baseline ${recorded.baseline}).`);
    for (const h of hits.slice(0, 400)) console.error(`  ${h.file}:${h.line} [${h.match}] ${h.text.slice(0, 100)}`);
    console.error('Use the plain words in lib/copy/jargon.ts, or move the words into an allowed zone (§0.6).');
    process.exit(1);
  }
  console.log(`check-jargon: ${count} (recorded ${recorded.current}, baseline ${recorded.baseline}, target at most ${recorded.targetMax}).`);
}
