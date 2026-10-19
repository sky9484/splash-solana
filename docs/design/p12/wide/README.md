# Wide window: before and after

Sky, 19 Oct 2026: on a computer the landing and the sign-in pages sat in a narrow column in the middle of the
window. They should run out to the red lines Sky drew, about 7% in from each edge, with no change on a phone.

Each picture is a 2,365 × 1,180 px window, the width of Sky's screenshot. Before is on top (`1dbbc6d`, the tip of
Phase 7) and after is below (`5da4696`), each taken on a freshly started dev server. The red lines are drawn on
afterwards, just outside the new content edge (166 and 2,199 px). The black "N" at the bottom left is Next's dev badge.

| Picture | What it shows |
|---|---|
| [`1-landing-hero.webp`](1-landing-hero.webp) | The landing's opening beat: the header row, the words and the district picture with its two coins |
| [`2-landing-step-03.webp`](2-landing-step-03.webp) | Step 03 of the pinned story: the picture grows with the window, its route card stays on its lower right |
| [`3-landing-platform.webp`](3-landing-platform.webp) | Platform and the start of Routes: the three cards and the two-column header across the frame |
| [`4-sign-in.webp`](4-sign-in.webp) | Sign in: the card runs to the lines; the form stays a 520 px column in its panel |

## Widths

| Window | Landing content | Header, partner and footer rows | Sign-in card |
|---|---|---|---|
| 390 px | unchanged | unchanged | unchanged |
| 1,024 px | 976 px, unchanged | 976 px, unchanged | unchanged |
| 1,440 px | 1,238 px (was 1,180) | 1,360 px, unchanged | 1,238 px (was 1,120) |
| 1,920 px | 1,651 px (was 1,180) | 1,651 px (was 1,360) | 1,651 px (was 1,120) |
| 2,365 px | 2,034 px (was 1,180) | 2,034 px (was 1,360) | 2,034 px (was 1,120) |
| 2,560 px and wider | 2,080 px, the cap | 2,080 px | 2,080 px |

From 1,600 px the display type, the lede, the hero's pictures and the sign-in picture also grow with the window;
under 1,600 px they are as before.
