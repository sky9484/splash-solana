// Does a link land on a page? Resolves an in-app href ("/dashboard/history?station=paid") against the
// App Router tree: exact folders first, then route groups "(x)" (they add no segment), then dynamic
// segments "[x]" and catch-alls "[...x]" / "[[...x]]". A link to a folder with no page.tsx is a 404.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

const dirs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isDirectory()) : []);

function hasPage(dir) {
  if (existsSync(path.join(dir, 'page.tsx')) || existsSync(path.join(dir, 'page.ts'))) return true;
  // A route group's page also answers for its parent's path, and so does an optional catch-all.
  return dirs(dir).some((n) => (/^\(.+\)$/.test(n) || /^\[\[\.\.\..+\]\]$/.test(n)) && hasPage(path.join(dir, n)));
}

function walk(dir, segments) {
  if (segments.length === 0) return hasPage(dir);
  const [head, ...rest] = segments;
  const names = dirs(dir);
  if (names.includes(head) && walk(path.join(dir, head), rest)) return true;
  for (const n of names) {
    if (/^\(.+\)$/.test(n) && walk(path.join(dir, n), segments)) return true;
    if (/^\[\[?\.\.\..+\]\]?$/.test(n) && hasPage(path.join(dir, n))) return true;
    if (/^\[[^.].*\]$/.test(n) && walk(path.join(dir, n), rest)) return true;
  }
  return false;
}

/** True when `href` (a path starting with "/") resolves to a page under app/. */
export function resolvesToPage(href) {
  const clean = href.split(/[?#]/)[0];
  return walk(APP, clean.split('/').filter(Boolean));
}

/** Every in-app link in rendered HTML (anchors only: React also preloads images with <link href>). */
export function hrefsIn(html) {
  return [...html.matchAll(/<a\s[^>]*?href="(\/[^"]*)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
}
