// Prompt 12 Phase 4: /working-capital as preview tab 3. Clean type (decision 8), the illustration in
// integer cents and labelled "Illustrative", "Where Supply fits" without pictures (D4), the footer as it
// was, and "Register financing interest" still going where it went.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { WC_ILLUSTRATION, usdText, bpsText } = await import('../lib/working-capital/illustration.ts');

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const PAGE = code('app/working-capital/page.tsx');
const CARD = code('components/supply/ReceivableCard.tsx');

test('the INV-4471 figures come from integer cents: US$100,000, 1.2%, US$98,800, US$1,200, about 4.9% a year', () => {
  assert.deepEqual(WC_ILLUSTRATION.minor, { face: 10_000_000n, early: 9_880_000n, discount: 120_000n });
  assert.equal(WC_ILLUSTRATION.face, 'US$100,000');
  assert.equal(WC_ILLUSTRATION.early, 'US$98,800');
  assert.equal(WC_ILLUSTRATION.discount, 'US$1,200');
  assert.equal(WC_ILLUSTRATION.discountRate, '1.2%');
  // 1,200 / 98,800 × 365 / 90 = 4.926…%, half-up to one place.
  assert.equal(WC_ILLUSTRATION.buyerSavesAYear, '4.9%');
  assert.equal(WC_ILLUSTRATION.invoice, 'INV-4471');
  assert.equal(WC_ILLUSTRATION.tenorDays, '90');
  // The formatters: grouping, cents only when there are any, basis points without trailing zeros.
  assert.equal(usdText(123_456_789n), 'US$1,234,567.89');
  assert.equal(usdText(100n), 'US$1');
  assert.equal(usdText(5n), 'US$0.05');
  assert.equal(bpsText(120n), '1.2%');
  assert.equal(bpsText(125n), '1.25%');
  assert.equal(bpsText(300n), '3%');
  // No float on the way: the module goes through lib/money.ts and nothing else.
  const src = code('lib/working-capital/illustration.ts');
  assert.match(src, /from '@\/lib\/money'/);
  assert.doesNotMatch(src, /parseFloat|toFixed|Math\.|Number\(|toLocaleString/);
});

test('the card says "Illustrative" next to its numbers, and the buyer saving reads as the preview has it', () => {
  // Beside the face value, and in the tags under the rows.
  assert.match(CARD, /Invoice face value<\/span>\s*<span className="lp-tag">Illustrative<\/span>/);
  assert.match(CARD, /\['Buyer-funded', 'No lender', 'Approval-gated', 'Illustrative'\]/);
  assert.match(CARD, /Buyer saves \(illustrative\) \$\{X\.discount\} on idle US dollars held about \$\{X\.tenorDays\} days, about \$\{X\.buyerSavesAYear\} a year\./);
  assert.doesNotMatch(CARD + PAGE, /\byield\b|\bAPR\b|\bAPY\b|\bearn|p\.a\.|per annum|\ba return\b/i, 'a buyer saving, never a return');
  // A radio group the keyboard can drive; no figure is typed into the card.
  assert.match(CARD, /role="radiogroup"/);
  assert.match(CARD, /role="radio"[\s\S]*aria-checked=\{choice === c\.id\}/);
  assert.match(CARD, /ArrowLeft[\s\S]*ArrowRight/);
  assert.doesNotMatch(CARD, /\d{1,3},\d{3}/, 'figures come from the illustration module');
});

test('the page: clean type, the preview’s order, no arrows or middle dots, and the interest button unchanged', () => {
  assert.doesNotMatch(PAGE + CARD, /iso-display|lp-display/, 'no extruded type on working capital (decision 8)');
  const order = ['Supply loop, roadmap', 'Coming capability, subject to licensing', 'Your invoices are', 'The receivable', 'Buyer-funded discounting', 'Where Supply fits', 'Shape the build order'];
  const body = PAGE.slice(PAGE.indexOf('export default function'));
  let at = -1;
  for (const words of order) {
    const i = body.indexOf(words);
    assert.ok(i > at, `"${words}" comes next`);
    at = i;
  }
  assert.match(PAGE, /<h1 className="wk-h1"[^>]*>\s*Your invoices are <em>working capital\.<\/em>/);
  // Three section heads (one h2 in Head) and the closing band's h2; cards are h3.
  assert.equal((body.match(/<Head\b/g) ?? []).length, 3);
  assert.equal((PAGE.match(/<h2 /g) ?? []).length, 2);
  assert.doesNotMatch(PAGE, /<h[4-6]\b/);
  // "Register financing interest" keeps going where it went (prompt 12 Phase 4: don't change its handler).
  assert.equal((PAGE.match(/<Link href="\/signup\?interest=financing" className="lp-btn lp-btn--gold lp-btn--lg">Register financing interest<\/Link>/g) ?? []).length, 2);
  assert.match(PAGE, /<Link href="\/signup" className="lp-btn lp-btn--dark">Start sending<\/Link>/);
  assert.match(PAGE, /<Link href="\/" className="lp-btn lp-btn--quiet">Back to Splash<\/Link>/);
  // No arrow on a button or link, no " · " string outside the footer, no durations, no reveal on scroll.
  const withoutFooter = PAGE.replace(/<footer[\s\S]*?<\/footer>/, '');
  for (const line of (PAGE + CARD).split('\n')) {
    if (/<(Link|button|a)\b|className="lp-btn/.test(line)) assert.doesNotMatch(line, /→|ArrowRight|ArrowLeft/, 'no arrow on a button or link');
  }
  assert.doesNotMatch(withoutFooter + CARD, / · /, 'no middle-dot strings');
  assert.doesNotMatch(PAGE + CARD, /\d+\s?ms\b/, 'durations live in CSS');
  assert.doesNotMatch(PAGE + CARD, /IntersectionObserver|whileInView|framer-motion|gsap/, 'no fade-on-scroll');
  // The footer is untouched, its line exactly as it was.
  assert.match(PAGE, /<footer className="wc-footer">\s*<div className="iso-shell wc-footer-inner">\s*<span>\{BRAND\.copyright\(\)\}<\/span>\s*<span>Supply loop: roadmap · Settle loop: sandbox on Solana devnet<\/span>/);
});

test('Where Supply fits: three text cards, Settle and Save live, Supply on the roadmap, and Save reads as no return', () => {
  const section = PAGE.slice(PAGE.indexOf('const loops'), PAGE.indexOf('function Head'));
  assert.doesNotMatch(section, /image|\.png|\.webp/, 'no pictures (D4)');
  assert.deepEqual([...section.matchAll(/name: '(\w+)',\s*role: '[^']+',\s*live: (true|false)/g)].map((m) => `${m[1]} ${m[2]}`), ['Settle true', 'Supply false', 'Save true']);
  assert.match(section, /copy: 'Idle US dollars wait in your own account\. Your business approves every move\.'/);
  assert.doesNotMatch(section, /projected|variable|posture/i, 'nothing on Save reads as a return');
});

test('styles/wc-p12.css: --sp-* tokens only, no upper case or mono, focus states, nothing loops, and globals imports it after the sign-in styles', () => {
  const css = read('styles/wc-p12.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'no raw colour');
  assert.doesNotMatch(css, /text-transform:\s*uppercase|font-mono|monospace/);
  assert.doesNotMatch(css, /\binfinite\b/, 'nothing moves by itself');
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(read('app/globals.css'), /@import "\.\.\/styles\/auth-p12\.css";\r?\n@import "\.\.\/styles\/wc-p12\.css";/);
});
