// Render a client component to HTML in a test, from a fixture. esbuild (installed with drizzle-kit)
// bundles the TSX using tsconfig's `@/` paths; Next's runtime modules are swapped for plain stand-ins
// (a Link is an <a>, an Image is an <img>, the router does nothing), and CSS is dropped. React and the
// libraries stay external, so the component and react-dom/server share one React.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const STUBS = {
  'next/link': `import { createElement } from 'react'; export default function Link({ href, children, prefetch, scroll, replace, ...rest }) { return createElement('a', { href: typeof href === 'string' ? href : String(href), ...rest }, children); }`,
  'next/image': `import { createElement } from 'react'; export default function Image({ src, alt, width, height, priority, unoptimized, ...rest }) { return createElement('img', { src, alt, width, height, ...rest }); }`,
  'next/navigation': `export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {} }); export const usePathname = () => '/dashboard'; export const useSearchParams = () => new URLSearchParams(); export const notFound = () => { throw new Error('notFound'); }; export const redirect = (url) => { const e = new Error('redirect'); e.digest = 'NEXT_REDIRECT;replace;' + url + ';307;'; throw e; };`,
};

/** Bundle `entry` (a path from the repo root) and import it. */
export async function loadTsx(entry) {
  const dir = path.join(ROOT, 'node_modules', '.cache', 'splash-render');
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${path.basename(entry).replace(/\W/g, '_')}-${process.pid}-${Date.now()}.mjs`);
  const result = await build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    target: 'node22',
    logLevel: 'silent',
    absWorkingDir: ROOT,
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server', 'framer-motion', 'lucide-react', 'clsx'],
    loader: { '.css': 'empty' },
    // A CommonJS dependency inside the bundle (bs58's buffer) still calls require().
    banner: { js: "import { createRequire as __splashRequire } from 'node:module'; const require = __splashRequire(import.meta.url);" },
    plugins: [
      {
        name: 'next-stubs',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|image|navigation)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js', resolveDir: ROOT }));
        },
      },
    ],
  });
  // Written under node_modules so the bundle's bare imports (react, lucide-react) resolve to the
  // project's own copies.
  writeFileSync(out, result.outputFiles[0].text);
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(out, { force: true });
  }
}
