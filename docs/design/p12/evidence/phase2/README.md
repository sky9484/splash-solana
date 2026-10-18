# Prompt 12 Phase 2 evidence: the landing

Taken on 18 Oct 2026 from `sol/b0-p12-2-landing`, on `next dev` (port 3300, its own Postgres on 5435), signed out.
Compare with `docs/design/p12/before/01-landing-*` and `02-landing-hero-*`.

| File | What it shows |
|---|---|
| `landing-1440` | The whole page at 1440 × 900, top to bottom as scrolled: the pinned story, the three loops, the partner rail, How it works, Platform, Routes, Southeast Asia, Comparison, Trust, Zeke, the closing band, the footer |
| `landing-390` | The same at 390 px in a desktop browser: under 700 px the CSS shows the phone hero (the backstop) |
| `landing-phone-390` | The same with an iPhone user agent: the server sends only the phone hero (`app/page.tsx`, `isPhoneUserAgent`) |
| `landing-reduced-motion-1440` | With `prefers-reduced-motion: reduce`: nothing pinned, the five beats stacked as plain sections, no bob |
| `hero-0-1440` … `hero-4-1440` | The pinned story at each beat (10, 30, 50, 70 and 90% of its scroll): the opening, then 01 an invoice arrives, 02 a person approves, 03 two routes, 04 the product, each with its card |
| `hero-tablet-0` … `-2-768` | The story at 768 × 1024: art on top, copy under it, no cards |
| `hero-phone-390` | The phone hero block (phone user agent) |
| `hero-phone-rail-1-390`, `hero-phone-rail-4-390` | The swipe rail on its first card, and after tapping the fourth dot: the card centred, the dot stretched, the counter at 4 / 4 |

## How they were taken

- `.p12-tools/shot.mjs`: `beats` and `vshot` shoot one viewport; `scroll` stacks one viewport frame per screen height,
  taken while scrolling, so the pinned story keeps its real height.
- The long images use `UNFIX=1`: the Paper ground is fixed to the window, so in a stack of frames it would repeat
  and leave a seam at each join. For these images only, the ground scrolls with the page (one gradient from top to
  bottom). In a browser it stays fixed.
- The fixed header and Next's dev badge show once, in the first frame; the back-to-top button shows in each frame
  after it, where a person sees it.

## Checked in the browser

- No sideways scroll at 1440, 1000, 768 and 390 px: `document.documentElement.scrollWidth` equals the window width
  at each. The comparison table scrolls inside its own box on a phone (720 px in a 358 px box).
- The rail: "03" jumps to beat 3, sets `aria-current="step"`, and the other beats are inert (no focus).
- The phone dots: tapping the third centres the third card and the counter reads 3 / 4.
- Reduced motion: the stage is `position: static`, the tokens have no animation, no beat is inert.
- A visible focus ring on every button, link and tile (teal on Paper, gold on the dark cyan bands).
