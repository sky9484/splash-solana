// Accessibility scan for the browser walkthrough: injects axe-core (already installed, through
// eslint-plugin-jsx-a11y) into the page and returns the serious and critical violations under the
// WCAG 2.x A and AA rules. Nothing is downloaded.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/** Serious and critical violations on the current page: [{ id, impact, help, nodes: [selector…] }]. */
export async function axeSerious(page, { include = 'body' } = {}) {
  await page.evaluate(new Function(`if (!window.axe) { ${AXE} }`));
  return page.evaluate(
    new Function(
      'include',
      `return window.axe.run(document.querySelector(include) ?? document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })
        .then((r) => r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) })));`,
    ),
    include,
  );
}
