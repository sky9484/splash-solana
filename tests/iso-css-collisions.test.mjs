// Prompt 11 Phase 5 found Treasury's sweep rows (`.iso-draft`, Phase 4) reusing the class of Check the
// invoice's "Zeke's draft" panel: the second rule's grid collapsed the panel. A base class is laid out
// in one place: outside media queries, no `.iso .iso-x` rule sets `display` twice.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/** The stylesheet without comments and without @media / @supports / @keyframes / @container blocks. */
function topLevel(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  for (let i = 0; i < text.length; ) {
    const at = /^@(?:media|supports|keyframes|container)[^{]*\{/.exec(text.slice(i));
    if (at) {
      let depth = 1;
      let k = i + at[0].length;
      for (; depth > 0 && k < text.length; k++) depth += text[k] === '{' ? 1 : text[k] === '}' ? -1 : 0;
      i = k;
      continue;
    }
    out += text[i++];
  }
  return out;
}

/** `.iso .iso-x` selector → the `display` values its top-level rules set. */
function displays(css) {
  const map = new Map();
  for (const m of topLevel(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const display = /(?<![-\w])display\s*:\s*([^;]+)/.exec(m[2])?.[1].trim();
    if (!display) continue;
    for (const sel of m[1].split(',').map((s) => s.trim())) {
      if (/^\.iso \.iso-[a-z0-9_-]+$/.test(sel)) map.set(sel, [...(map.get(sel) ?? []), display]);
    }
  }
  return map;
}

test('no base class is laid out twice in the Iso stylesheet', () => {
  const twice = [...displays(readFileSync('styles/iso-ui.css', 'utf8'))].filter(([, v]) => v.length > 1).map(([k, v]) => `${k}: ${v.join(' / ')}`);
  assert.deepEqual(twice, []);
});

test('the check catches the collision it was written for', () => {
  const css = '.iso .iso-draft { display: flex; }\n@media (max-width: 600px) { .iso .iso-draft { display: block; } }\n.iso .iso-draft { display: grid; }';
  assert.deepEqual(displays(css).get('.iso .iso-draft'), ['flex', 'grid']);
  assert.deepEqual(displays('.iso .iso-a { display: flex; }\n@media (x) { .iso .iso-a { display: grid; } }').get('.iso .iso-a'), ['flex'], 'a media query may change it');
});
