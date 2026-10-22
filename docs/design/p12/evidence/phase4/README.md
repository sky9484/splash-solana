# Prompt 12 Phase 4 evidence: working capital

Taken on 19 Oct 2026 from `sol/b0-p12-4-working-capital`, on `next dev` (port 3300, its own Postgres on 5435), signed
out. Compare with `docs/design/p12/before/03-working-capital-*` and the preview's tab 3.

| File | What it shows |
|---|---|
| `working-capital-1440`, `-390` | The whole page, full height: top nav, the dark cyan hero with the INV-4471 card, sections 01 to 03, the closing band, the footer as it was |
| `working-capital-early-1440`, `-390` | The INV-4471 card as it loads: "Take early payment" chosen, US$98,800, 1.2% and US$1,200, the coral note "Buyer saves (illustrative) US$1,200 … about 4.9% a year." At 1440 the first screen; at 390 scrolled to the card (it starts 794 px down) |
| `working-capital-hold-1440`, `-390` | The same after choosing "Hold to maturity": "In 90 days", US$100,000, no discount, "Nothing changes." |
| `landing-1440` | The landing as scrolled at 1440 px, after `.lp-wrap` became 1,180 px of content (below) |

- Ground: Paper (`main.wc-page.sp-ground-paper`, `linear-gradient(#FFFAF4, #F3EBE0)` fixed), no grid, from
  `.p12-tools/grounds.mjs`.
- At 390 px the page is 390 px wide (`scrollWidth === innerWidth`), and every link and button is at least 44 px tall.
- The black "N" circle at the bottom left is Next's dev badge, not part of the page.
- **The content width.** The preview's sections carry both `sec` and `wrap`, and its `.sec { padding: 72px 0 }` comes
  after `.wrap`, so its sections are a full 1,180 px wide (measured: three cards of 382.66 px with 16 px gaps). Our
  `.lp-wrap` kept its 24 px gutter inside 1,180, so the landing (Phase 2) and this page were 1,132 px. `.lp-wrap` is now
  1,228 px with the gutter: 1,180 px of content on a wide screen, and phones keep their 16 px edge (the preview's
  sections touch the screen edge there).
