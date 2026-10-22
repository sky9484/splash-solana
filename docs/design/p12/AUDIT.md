# Dashboard audit after prompt 11 (and Sky's restyle), 18 Oct 2026

**How I checked:** built and ran `sol/b0-p9-6-restyle` @ `6a65016` (the newest branch, 16 Oct) here with the seeded demo company, then ran the UI walkthrough (`tests/solana-ui.e2e.mjs`, 157 screenshots at 1440 and 390 px) plus a scripted pass over the signed-out pages and the landing. Everything below was seen on screen, not inferred from code. Feeds prompt 12.

## A. Pages still on the old design (not restyled)
| Page | What it shows | Why it matters |
|---|---|---|
| **Receipt** (`/dashboard/receipts/[id]`) | The 2025 look: blue-grey text, caps "TECHNICAL DETAILS" eyebrows, hash-heavy blocks, old dark buttons, no 30 px boxes. The one page an accountant actually opens. | Preview 5 and 6 replace it. |
| **Shared auditor receipt** (`/receipt/[token]`) | Same old design, on a white page. | Preview 6 replaces it. |
| **Recipients** | The old "Global directory" template: Corridor mix (USD→SG/ID/MY, with made-up percentages), Compliance check, Quick actions, Beneficiary stats. Says "No recipients found" while two suppliers were just paid. Different corner radius, different type. | Needs a rebuild in the dashboard language: a list of saved recipients with last-4, country, verified-by-call-back date, last paid; a New recipient button that opens the Transfer sheet. |
| **Batch payout** | Old caps eyebrow "PAYMENTS", old table, old summary card. | Copy-only was the prompt 10 rule; the boxes and table should at least take the new surfaces. |
| **Settings** (General, Payment rules, Devices, Recovery kit, Account details) | Dark navy pill tabs, caps "SETTINGS" eyebrow; the Rules list is fine, Devices has oversized text and a yellow banner. | Surfaces + tabs to the new style; keep the copy. |
| **History** | Mostly fine, but the caps "MONEY" eyebrow and the dark pill filter tabs don't match Invoices' tabs. | Use the Invoices tab style. |
| **404 page** | Next.js default ("404 · This page could not be found") on a bare gradient. | A Splash 404 in the dashboard language. |
| **Error page** ("This screen could not load") | Serviceable, but the old gradient background and old button style. | Same surfaces as the rest. |
| **Sign in / Sign up / Forgot / Reset / Verify email** | Dark teal panel with a 24 px grid, caps mono labels, "USD SETTLEMENT INFRASTRUCTURE"; images repeat landing art (settlement-machine on sign-in, treasury-island on forgot/reset/verify). | Preview 7. |
| **Loading screen** | Droplet on ripple rings, shimmer bar, "Preparing your desk", on the old grid. | Preview 7. |

## B. Flaws on pages that were restyled
1. **Transfer step 5, the receipt card** (Sky's screenshot): three columns of label/value pairs with mixed alignment; "Approved by" and "Bank reference" wrap under their labels; no receipt number; actions scattered (Verify top right, Share / Download PDF / Full receipt at the bottom). Preview 5 fixes the layout; preview 6 is the PDF it downloads.
2. **Zeke page:** the chat box is a tall cyan-bordered frame with most of it empty; the "Drafts today / Need you / Notices" stat cards are fine. Give the chat a fixed height with the log scrolling inside, and let the right column (Waiting for you, Today, How Zeke is kept safe) set the height.
3. **Treasury "Interest per day" chart** is empty for a new company ("No interest booked in these 7 days yet"), with a 200 px blank box. Show the chart only once there is a day of data; until then one line of text.
4. **Treasury activity** lists "Moved out · you approved" twice for the same day with no times: add the time and the destination.
5. **Overview "Needs you"** shows only "Add a second approver · Optional" as a thing that needs you. Optional set-up isn't a need; move it to the setup card.
6. **Sidebar "Account setup 5 of 6"** box stays forever with "Next: add a second approver" (optional). Hide the box once every required step is done.
7. **The restyle broke the walkthrough:** `tests/solana-ui.e2e.mjs` still expects "Rules" in the sidebar's Control group; the restyle moved Rules into Settings. Nobody re-ran the e2e after the restyle. Prompt 12 must fix the test and run it.
8. **Top row "USD → PHP 57.40 · test rate · USD → IDR next corridor"** is a strip that reads like a ticker; on the restyle it's a 30 px pill, but "IDR next corridor" is marketing in a product chrome. Keep the rate, drop the roadmap.
9. **Invoices chooser:** the two cards are solid cyan with gold buttons (restyle), but the coins sit on the dark cyan with their cream halo visible. Either knock out the halo or use the card's own colour behind the coin.
10. **Balance "Add money" cards:** three cards, three button styles (primary ledge, quiet, quiet). One style per row.
11. **Batch payout "Rehearse a problem (offline only)"** is a native `<select>`: the only unstyled control on the dashboard.
12. **Recipients page** also shows "Payment status and history live in History" as copy: a page admitting it does nothing.

## C. Landing (what Sky asked for, confirmed on screen)
- **Hero:** a 4,680 px sticky "cinematic": callouts pop around the island, the island zooms in and fades, then a separate "Payments are the feature. Proof is the product." headline. Preview 1 replaces it with one pinned story in five beats that ends on that line.
- **The three loops:** sits on a peach-tinted background (a radial coral wash on `--iso-paper-deep`) unlike every other section. "02 Keep" uses `liquidity-pools`, the same image as Platform 01. Preview 2: same sand as the rest; 02 Keep gets `loop-save-v3`, an unused asset made for it.
- **How it works:** 01 Your vault uses `treasury-island` (also Platform 03, forgot-password, reset, verify-email); 03 A person approves uses `settlement-machine` (also Platform 02 and the sign-in page). Preview 2: 03 gets `flow-settle-v4` (the stamp, unused until now); 01 gets a new image (brief A).
- **Comparison:** "Built for business. Designed to move." runs straight into the "USDC in. Pesos out." corridor block, which is nested inside the comparison section; the table (5 rows) arrives after it. Preview 3 splits them and grows the table to 10 rows.
- **Working capital page:** old pale-grey chapter dividers, giant "01/02/03" watermarks, square ledged cards, grid background. Preview 4 puts it in the dashboard language, footer untouched.
- **Unused art in the repo** that solves the repeats without generating anything: `loop-save-v3`, `flow-settle-v4`, `flow-collect-v4`, `flow-deliver-v4`, `treasury-island-clean`.

## D. Images to generate once the direction is chosen
| # | Where | Brief (same isometric camera, palette ink #083640 / teal #0D6370 / mint / gold, transparent background, 1600 × 1200) |
|---|---|---|
| A | How it works · 01 Your vault | Keys being cut in a browser window; a vault door with two keyholes (device key, recovery kit); no Splash key on the ring. |
| B | Sign in | The approver's desk at night: a laptop with a glowing passkey prompt, a phone beside it, one gold coin on a tiny wire from laptop to a bank on the desk edge. |
| C | Sign up | A new desk being assembled on a tile: a vault door still on a trolley, a nameplate, a rolled-up route map, empty receipt frames. |
| D | Forgot password | A sealed envelope arriving on a wire to a mailbox on a tile, a small key tag on it; the vault behind it stays shut. No coins. |

## E. Skills used
`frontend-design`, `isometric-typography-designer`, `motion-web-designer`, `payments-treasury-expert`, `fintech-architect`, `qa-verification-engineer`. **Not available in this session:** `ui-ux-pro-max` and `design-taste-frontend` (listed as mandatory in `AGENTS.md`); Claude Code on Sky's machine has them and must load them for prompt 12.
