# Look 9: the approved dashboard frames

Sky chose look 9 ("route map with coins") on 13 Oct 2026. These three files are the source of the approved frames on the "Look 9 · final" page of the "Splash dashboard concept" canvas. Prompt 09 builds the dashboard to match them.

| File | Screen | Prompt 09 section |
|---|---|---|
| `Final-Overview.dc.html` | Overview (`/dashboard`) | §4 (Phase 2) |
| `Final-Transfer.dc.html` | Transfer, Step 3 "Quote & send", bank path, with the approval card | §5.6–5.7 (Phase 3) |
| `Final-Treasury.dc.html` | Treasury, test mode, with the buy and sell sheets (gate G4: Sky still reviews its copy and figures) | §7 (Phase 5) |

## How to read them
- They are **canvas source, not app code.** They don't run in Next.js and shouldn't be copied in as they are. Port the structure, copy, numbers and styles into `components/iso/*` and the pages.
- The markup is a small template language:
  - `<x-dc>` wraps the frame; `<helmet>` holds the fonts and the `<style>` block (the classes used in the frame).
  - `{{ name }}` is a value from the frame's logic class at the bottom (`class Component extends DCLogic`, `renderVals()`); `onClick="{{ fn }}"` is a click handler.
  - `<sc-if value="{{ x }}">` shows its contents only when `x` is true; `<sc-for>` repeats them.
  - Inline `style="…"` attributes are the real spacing, sizes and colours. Treat them as the spec.
- Images point at the repo's own art: `/cinematic/brand-mark.png`, `/cinematic/token-usd.png`, `/cinematic/token-php.png`, `/cinematic/vault-transparent.png`.
- The numbers are the agreed demo scenario (INV-0415, ₱287,000 at 57.40 = US$5,000.00; accounts US$25,000 / US$31,460 / US$40,000). In the app every number comes from server state; none is hard-coded.

## Colours used (all in prompt 09 §2.1)
| Role | Value |
|---|---|
| Paper (surfaces) | `#FFFAF4` |
| Ground (page) | `#F6F0ED`, 24 px grid at 5% ink |
| Ink / ink-deep | `#0C3E48` / `#083640` |
| Ledge on the dark sidebar | `#041C22` |
| Teal / mint | `#0D6370` / `#9FCFC7` |
| Gold (coins, test mode, treasury opportunity) | `#EFC46F` |
| Coral (approval only) | `#E39774`, ink text on it |
| Amber warning | text `#8A5208` on `#FBEFDD` |
| OK | text `#1F6152` on `#E4F1ED` |
| Danger | text `#B3402F` on `#F9E7E3` |
| Sidebar | `linear-gradient(165deg, #245563 0%, #143c47 55%, #0c3039 100%)` |

## Rules the frames follow (and the build must too)
- One extruded number per screen (`.x-display` here, `.iso-display` in the build).
- Solid offset ledges only (`3px 3px 0`, `5px 5px 0`, `6px 6px 0`), square corners, no blurred shadows.
- Coins move along a wire only while money really moves there. On the Overview frame nothing is in flight, so every wire is quiet.
- Plain language (prompt 09 §0.6): "US$", "Payments account", "Reserve", "Investments", "Approve on this device", "Test mode", "proof recorded". Crypto words only inside "How it moves" and "Technical details".
- Route labels are "Cheapest" and "Fewest steps" only. No speed or time words.
- The payout partner is "your payout partner" until signed. Ondo is the issuer of USDY, never "our partner".
- Treasury says "rate" for USDY and "Dividends, past 12 months" for stocks, never "yield".
