# Look 9: the approved dashboard frames

Sky chose look 9 ("route map with coins") on 13 Oct 2026. These 14 files are the source of the frames on the "Look 9 · final" page of the "Splash dashboard concept" canvas: every dashboard screen prompt 10 rebuilds, plus the floating Zeke. Prompt 10 builds the dashboard to match them.

All of them are on the canvas page "Look 9 · final" and link to each other (sidebar, buttons, step rail), so the canvas plays as one clickable prototype.

| File | Screen | Prompt 10 section |
|---|---|---|
| `Final-Overview.dc.html` | Overview (`/dashboard`) | §4 (Phase 2) |
| `Flow-T1-Recipient.dc.html` | Transfer, Step 1: bank account or Splash business, saved recipients, the new-recipient sheet (full number typed twice) | §5.3–5.4 (Phase 3) |
| `Flow-T2-Amount.dc.html` | Transfer, Step 2: coupled "They receive" / "You send", rail, reference, purpose, limits | §5.5 (Phase 3) |
| `Final-Transfer.dc.html` | Transfer, Step 3 "Quote & send": route map, Cheapest / Fastest lanes, cost, money comes from | §5.6 (Phase 3) |
| `Flow-T4-Approve.dc.html` | Transfer, Step 4: the approval card over the dimmed Step 3; rules 8 of 8; press → tick (Tweaks: joint approval) | §5.7 (Phase 3) |
| `Flow-T5-Track.dc.html` | Transfer, Step 5: the six-station tracker and the receipt (Tweaks: sent / with partner / paid / proof) | §5.8 (Phase 3) |
| `Flow-Inv-Choose.dc.html` | Invoices chooser: Get paid / Pay an invoice | §6.1 (Phase 4) |
| `Flow-Inv-Pay.dc.html` | Pay an invoice: drop zone and bills by status | §6.2 (Phase 4) |
| `Flow-Inv-Check.dc.html` | Check the invoice: document lines beside Zeke's fields, masked account with Show number, amber call-back panel | §6.2 (Phase 4) |
| `Flow-Inv-GetPaid.dc.html` | Get paid: requests and the composer with a live preview | §6.3 (Phase 4) |
| `Final-Treasury.dc.html` | Treasury, test mode: T-bills with Subscribe / Redeem and Hold / Sweep (with Zeke's sweep draft), stocks with Buy, and their sheets (gate G4: Sky still reviews its copy and figures) | §7 (Phase 5) |
| `Flow-Balance.dc.html` | Balance: Payments account, add money (top-up, crypto wallet, from a customer), money in and out | §5.10 (Phase 3) |
| `Flow-Zeke.dc.html` | Zeke page: chat desk, drafts waiting, today's log, safety, what each part does | §7A (Phase 6) |
| `Flow-Zeke-Floating.dc.html` | Floating Zeke: resting, something needs you, open on a page, open on a phone | §3.5 (Phase 1) |

## How to read them
- They are **canvas source, not app code.** They don't run in Next.js and shouldn't be copied in as they are. Port the structure, copy, numbers and styles into `components/iso/*` and the pages.
- The markup is a small template language:
  - `<x-dc>` wraps the frame; `<helmet>` holds the fonts and the `<style>` block (the classes used in the frame).
  - `{{ name }}` is a value from the frame's logic class at the bottom (`class Component extends DCLogic`, `renderVals()`); `onClick="{{ fn }}"` is a click handler.
  - `<sc-if value="{{ x }}">` shows its contents only when `x` is true; `<sc-for>` repeats them.
  - Inline `style="…"` attributes are the real spacing, sizes and colours. Treat them as the spec.
- Zeke's art is `/cinematic/agent-bot-cut.png` (the robot), on a paper tile.
- Images point at the repo's own art: the real Splash logo `/splash-main-icon.png` (the S mark, on a small paper tile in the sidebar so its teal reads on the dark gradient), `/cinematic/token-usd.png`, `/cinematic/token-php.png`, `/cinematic/vault-transparent.png`. The isometric droplet (`/cinematic/brand-mark.png`) is illustration, never the logo.
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
| Hero wash (the one hero surface per screen) | mint `#DDEFEA` top-left fading through `#EAF4EF` to paper `#FFFAF4` (135°), the 24 px grid at 6% ink on top, 2 px ink border, `6px 6px 0` ledge (`.hero-wash`) |

## Rules the frames follow (and the build must too)
- One extruded number per screen (`.x-display` here, `.iso-display` in the build).
- Solid offset ledges only (`3px 3px 0`, `5px 5px 0`, `6px 6px 0`), square corners, no blurred shadows.
- Coins move along a wire only while money really moves there. On the Overview frame nothing is in flight, so every wire is quiet.
- Plain language (prompt 09 §0.6): "US$", "Payments account", "Reserve", "Investments", "Approve on this device", "Test mode", "proof recorded". Crypto words only inside "How it moves" and "Technical details".
- Route labels are "Cheapest" and "Fastest" only (Sky, 13 Oct). "Fastest" is a ranking label from the engine's estimates; no times, durations or other speed words anywhere.
- The payout partner is "your payout partner" until signed. Ondo is the issuer of USDY, never "our partner".
- Treasury bills: "Subscribe" and "Redeem", with "Hold" or "Sweep" for idle cash (Zeke drafts each sweep from the owner's rule; a person approves it). Stocks and ETFs: "Buy" and "Sell".
- Treasury says "rate" for USDY and "Dividends, past 12 months" for stocks, never "yield", "APR", "APY" or "earn".
