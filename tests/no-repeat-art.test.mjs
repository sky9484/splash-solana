// Prompt 12 §2.12 (Sky's decision 15: "no repeated images incl landing & dashboard"): a raster image is
// used by at most one of four surfaces, the landing, the sign-in pages, the dashboard and working capital
// (Phase 4, D4: its "Where Supply fits" cards show no pictures because they would repeat the landing's
// loops). Repeats within one surface are fine (D3: Reset password reuses Forgot's image, Verify email
// reuses Sign up's).
// Code only: comments are stripped, so a note may name an image it doesn't show.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

const SURFACES = {
  landing: ['components/IsometricLanding.tsx', 'components/landing'],
  auth: ['components/auth', 'app/login/page.tsx', 'app/signup/page.tsx', 'app/forgot-password/page.tsx', 'app/reset-password/page.tsx', 'app/verify-email/page.tsx'],
  dashboard: ['app/dashboard', 'components/solana', 'components/dashboard'],
  'working capital': ['app/working-capital/page.tsx', 'components/supply'],
};

/** Images every surface may share, and why. */
const ALLOWED = [
  { match: (path) => path === '/splash-main-icon.png', why: 'the brand mark: every surface carries the logo' },
  { match: (path) => /^\/cinematic\/token-[a-z0-9-]+\.png$/.test(path), why: 'the currency token coins: the same money wherever it shows' },
  { match: (path) => path === '/cinematic/agent-bot-cut.png', why: 'Zeke’s avatar, which belongs to the dashboard' },
];


const RASTER = /['"`](\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|avif|gif))['"`]/g;
const CODE = new Set(['.ts', '.tsx', '.mjs']);

function filesOf(entry) {
  if (!existsSync(entry)) throw new Error(`${entry} is on the surface list but doesn't exist`);
  if (!statSync(entry).isDirectory()) return [entry];
  return readdirSync(entry).flatMap((name) => filesOf(join(entry, name).replaceAll('\\', '/')));
}

function strip(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** path → { surface → [files] } */
function uses() {
  const out = new Map();
  for (const [surface, entries] of Object.entries(SURFACES)) {
    for (const file of entries.flatMap(filesOf).filter((f) => CODE.has(extname(f)))) {
      for (const [, path] of strip(readFileSync(file, 'utf8')).matchAll(RASTER)) {
        if (!out.has(path)) out.set(path, {});
        const where = out.get(path);
        (where[surface] ??= []).includes(file) || where[surface].push(file);
      }
    }
  }
  return out;
}

test('no raster image appears on two of the landing, the sign-in pages, the dashboard and working capital', () => {
  const repeats = [];
  for (const [path, where] of uses()) {
    if (ALLOWED.some((a) => a.match(path))) continue;
    const surfaces = Object.entries(where);
    if (surfaces.length > 1) repeats.push(`${path}: ${surfaces.map(([s, files]) => `${s} (${files.join(', ')})`).join(' and ')}`);
  }
  assert.deepEqual(repeats, [], `\n  ${repeats.join('\n  ')}\n`);
});

test('the check sees the landing’s, the sign-in pages’, the dashboard’s and working capital’s images', () => {
  const all = uses();
  const on = (surface) => [...all].filter(([, where]) => where[surface]).map(([path]) => path);
  assert.ok(on('landing').includes('/isometric/gen/hero-01-zeke-reads-invoice.webp'), 'the landing hero art is read');
  assert.ok(on('landing').includes('/isometric/gen/platform-03-treasury-vault.webp'), 'platform 03, Sky’s treasury vault (21 Oct), is read');
  assert.ok(on('auth').includes('/isometric/gen/auth-signin-night.webp'), 'the sign-in pages are read');
  assert.ok(on('dashboard').includes('/cinematic/agent-bot-cut.png'), 'the dashboard is read');
  assert.ok(on('working capital').includes('/isometric/wc-receivable-1.png'), 'working capital is read');
});
