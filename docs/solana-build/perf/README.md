# Motion and accessibility evidence (prompt 10 §8, §9)

Measured on 14 Oct 2026 against the isolated dev server (`next dev`, port 3200, its own database), signed in, with test data. These files are the summaries; the full traces and reports stay with whoever ran them.

| File | What it holds |
|---|---|
| `motion-trace.json` | Chrome's performance trace at 4× CPU throttling, 390 × 844 at 2×: frames drawn, frame rate, the worst gap between frames, frames over 33 ms and main-thread tasks over 50 ms, for three windows (Overview's load, Treasury with the Move sheet open, the Zeke page's load). Also the animations still running with `prefers-reduced-motion: reduce` (none). |
| `lighthouse-accessibility.json` | Lighthouse 12.6.1, accessibility category, nine pages at desktop and mobile: the score and any failing audit. |
| `axe-zeke-open.json` | axe-core (the engine behind Lighthouse's accessibility audits) with the floating Zeke open, eight pages at 1440 and 390 px: serious and critical WCAG 2.1 A/AA violations. Lighthouse can't open the panel itself. |

## Reading them

- **The dev server is slower than production:** React runs unminified and in development mode, so the load windows' long tasks are page loading, not the animations. A production-build trace isn't here: `next start` won't boot without live secrets, and the env check isn't weakened to get one.
- **`label-content-name-mismatch`** is listed on the desktop pages for the logo button, which collapses the navigation. Its brand words are hidden from screen readers, so its name stays "Collapse navigation". Lighthouse weights this audit at zero.
- **Transfer Steps 2, 4 and 5** are states inside one page, reached by clicking. Lighthouse's navigation mode can't click, so the walkthrough (`tests/solana-ui.e2e.mjs`) runs axe on them instead.
