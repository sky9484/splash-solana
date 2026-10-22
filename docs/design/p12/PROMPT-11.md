# Splash Solana build prompt 11: floating surfaces, the new Transfer flow, Invoices motion, Smart Treasury

**Written:** 14 Oct 2026 (night). **For:** Claude Code, run on Sky's computer in `sky9484/splash-solana`.
**Builds on:** prompt 10 and its branches, latest tip `sol/b0-p8-7-check` @ `b41dc50`. Prompt 10's rules (§0) still apply unless this prompt changes them.
**Approved preview:** "Splash dashboard preview" artifact, version 4 (https://claude.ai/artifact/1tEqKTpaZxquAa2iXY6kHU). It is a React mock, not app code. Copy its layout, sizes, words and motion; never paste its code.

## Sky's decisions (14 Oct, all CONFIRMED)

| # | Decision | Sky said |
|---|---|---|
| 1 | Keep today's build. Change only the page colour and the boxes on top of it. | "i love what is the current build now… just want a better background colour to all and better container box floating from the background" |
| 2 | Page colour: **Warm paper**, today's colour with **no grid**. | "warm paper" |
| 3 | Every box is lifted off the page by a soft shadow. It rises a little on hover and settles back when the pointer leaves. | "lift up like floating from background and have a shadow. pop up a little when we hover each section and go back to normal when not hover" |
| 4 | Transfer uses the new five-step pattern from the preview, with the dark intent header on top of **every** step. | "i want the transfer pattern that we are building/doing now" |
| 5 | Invoices opens on the two big cards (Get paid / Pay an invoice), and the clicked card grows into its page. | "like the image i show you as the start flow and the effect when we click either one" |
| 6 | Balance keeps today's layout. Only the boxes change. | "the current balance page now on the current build is good" |
| 7 | Treasury keeps today's **All accounts** section on top. The live T-bill card with the "Interest per day" chart goes directly below it. The rest follows the preview. | "keep that section. the third image is below it. the rest update to what we discuss now" |
| 8 | Treasury bills: the money goes into Ondo's USDY in the company's own Investments account. Words stay "Subscribe" / "Redeem", never "Buy", "Deposit", "yield", "APR" or "earn". | 14 Oct (earlier) |
| 9 | Sweep: Zeke drafts; **a person approves every move**. No standing rule that moves money by itself. | "sweep approve every move" |
| 10 | Most businesses take money back about once a quarter, so slow redemption is acceptable. Zeke drafts a quarterly "bring this quarter's interest back" move, and a person approves it. | "they usually hold it for more than a month… withdraw every quarter" |
| 11 | Stocks and ETFs stay. They are bought through **Treasurers**, Splash's stock partner. Name it like that, with no web address. | "it's a stock partner, just put treasurers" |
| 12 | Overview, Zeke page and floating Zeke: layout unchanged; new surfaces only. | 14 Oct |

**Two things Sky accepted knowingly (write both in the PR):**
- Naming Treasurers in the app before a signed agreement goes against canon's "no unsigned partner names" rule. Sky waived it for Treasurers only. Every other partner stays unnamed ("your payout partner").
- The quarterly interest draft is usually smaller than the US$500 sweep minimum, so it gets its own minimum (§5.4).

---

You are working in `sky9484/splash-solana`. Read this whole prompt before changing anything. Work phase by phase. A box is ticked only when you saw it pass, and the evidence (screenshot, test name, command output) is in the PR. Anything you couldn't verify goes in the README "Not verified yet" list.

## 0. Ground rules

### 0.1 Read first
`AGENTS.md`, `CLAUDE.md`, prompt 10 (`docs/prompts/` copy, or Sky's project doc `splash/sebastian-prompt-10-complete_v15.1_2026-10-13.md`) §0 and §5–§8, `styles/tokens.css`, `styles/iso-ui.css`, `components/iso/*`, `components/solana/transfer/*`, `components/solana/invoices/InvoicesChooser.tsx`, `components/iso/Morph.tsx`, `components/solana/Balance.tsx`, `components/solana/treasury/Treasury.tsx`, `lib/treasury/*`, `lib/solana-app/investments.ts`, `tests/claims.test.mjs`. Next.js 16 has breaking changes: read `node_modules/next/dist/docs/` before touching routes or view transitions.

### 0.2 Toolchain and skills
- Node `>=24.11 <25`, npm `>=11`. Run `node -v` first; stop if it's wrong.
- Load before starting, and list the ones used and missing in the PR:
  - mandatory per `AGENTS.md`: `ui-ux-pro-max`, `isometric-typography-designer`, `frontend-design`, `design-taste-frontend`;
  - also: `motion-web-designer`, `payments-treasury-expert`, `agentic-finance-expert`, `fintech-architect`, `qa-verification-engineer`.

### 0.3 Branches
- `git fetch && git checkout -b sol/b0-p9-base origin/sol/b0-p8-7-check`, then push it.
- One branch and one PR per phase, each into `sol/b0-p9-base`:
  - `sol/b0-p9-0-before`
  - `sol/b0-p9-1-surfaces`
  - `sol/b0-p9-2-transfer`
  - `sol/b0-p9-3-invoices`
  - `sol/b0-p9-4-treasury`
  - `sol/b0-p9-5-check`
- At the end, open one PR from `sol/b0-p9-base` into `sol/b0-p8-7-check`, so it rides on prompt 10's open stack (PR #24). If Sky has merged that stack by then, target `sol/b0-p8-design` instead and say so.
- Never commit to or push `main` or `build/solana-colosseum`. Never force-push.

### 0.4 Claims (prompt 10 §0.5 stays, with these changes)
- **Allowed now:** "Treasurers" as the name of the stock partner, only on the stocks card, its sheets and Risk and rules. **Not allowed:** a web address for it, "licensed", or "our partner" next to Ondo.
- **Stocks change:** they used to say "via Ondo". They now say "via Treasurers". The stock tokens' issuers appear only in "Technical details".
- **Still banned:** "yield", "APY", "APR", "earn", "instant", "guaranteed", "autonomous", and any delivery time. "Interest" is allowed for USDY only: "Interest per day", "Interest today · live estimate".
- **Add to `tests/claims.test.mjs`:**
  - "treasurer.io", "treasurers.io", "treasures.io" anywhere a customer reads;
  - "via Ondo" on the stocks surfaces;
  - "auto-sweep", "automatic sweep", "sweeps automatically".

### 0.5 Checks before every push
Same list as prompt 10 §0.9:
- `npm run test:claims`
- `npm run test:solana`
- `npm run test:auth`
- `npm test`
- `npx tsc --noEmit -p tsconfig.json`
- `npm run lint`, including `check-iso-ui` and `check-jargon` (the jargon count must not rise)
- `npm run build`
- `tests/solana-ui.e2e.mjs` at 1440 px and 390 px

### 0.6 Money
Integers only, through `lib/money.ts`. The live "interest today" figure in §5.2 is the **only** floating-point number, it is display-only, and it never reaches the ledger, an order, an evidence bundle or Zeke. Test that.

---

## Phase 0 · Before pictures (`sol/b0-p9-0-before`, no app code)

Sky runs the app at `http://localhost:3200`.

**Pages to capture:**
- Overview
- Transfer steps 1–5 (bank recipient)
- Transfer steps 1–3 (Splash business)
- Invoices: chooser, Pay, Check, Get paid
- Balance
- Treasury, with Hold and with Sweep
- Zeke
- Floating Zeke, open

**Steps:**
1. Sign in with the seeded **test** account from the project's seed or fixture files. Never use a real person's password, and don't print the credentials in the PR.
2. Screenshot every page above at 1440 px and 390 px into `docs/design/p9/before/`.
3. Write `docs/design/p9/COMPARE.md`, one row per screen, three columns: what the build shows today; what the preview shows; what this prompt changes.
   - If the build differs from what this prompt assumes (for example, a section the preview lacks), **keep the build's version**. Note it under "Build has, preview lacks".
   - Sky asked for that comparison, and it decides any conflict in favour of today's build, except on Transfer and Treasury, where this prompt wins.

**Acceptance:**
- [ ] Every page above captured at both widths.
- [ ] COMPARE.md is filled in.
- [ ] No app files changed.

---

## Phase 1 · Warm paper and floating boxes, every page (`sol/b0-p9-1-surfaces`)

### 1.1 Tokens (`styles/tokens.css`)

| Token | Value | Note |
|---|---|---|
| `--ground` | `#F4EEE9` | warm paper, a touch lighter than today's `#F6F0ED` |
| `--grid`, `--grid-hero` | keep the tokens, stop using them on the dashboard | the landing still uses them |
| `--surface` | `#FFFDFA` | box fill; `--paper` stays for the sidebar tile and text |
| `--surface-line` | `rgb(12 62 72 / .09)` | 1 px box edge |
| `--lift-1` | `0 1px 2px rgb(8 54 64 / .06), 0 10px 24px -12px rgb(8 54 64 / .26)` | resting box |
| `--lift-2` | `0 2px 4px rgb(8 54 64 / .07), 0 22px 40px -14px rgb(8 54 64 / .34)` | hovered box |
| `--lift-hero` | `0 2px 4px rgb(8 54 64 / .07), 0 18px 38px -16px rgb(8 54 64 / .34)` | hero at rest |
| `--lift-hero-2` | `0 3px 6px rgb(8 54 64 / .08), 0 28px 52px -18px rgb(8 54 64 / .42)` | hero hovered |
| `--rise` | `-3px` | hover lift; the Invoices chooser cards use `-5px` |
| `--t-lift` | `220ms` with `cubic-bezier(.2,.7,.2,1)` | |

### 1.2 Surfaces (`styles/iso-ui.css`)
- `.iso-ground`:
  - background `var(--ground)`, **no grid images**, on the dashboard only;
  - `app/pay/**`, `app/receipt/**` and the landing keep their grid.
- `.iso-surface`:
  - background `var(--surface)`, `1px solid var(--surface-line)`, `box-shadow: var(--lift-1)`;
  - square corners, as today;
  - transition `transform` and `box-shadow` over `var(--t-lift)`.
- `.iso-surface--hero`:
  - keep the mint wash, drop the grid lines;
  - `box-shadow: var(--lift-hero)`;
  - replace the hard `6px 6px 0` ledge.
- **Hover**, only on `@media (hover: hover) and (pointer: fine)`:
  - `.iso-surface:hover { transform: translateY(var(--rise)); box-shadow: var(--lift-2) }`;
  - the hero uses `--lift-hero-2`.
- **Don't lift on hover:** sheets, the approval moment, the floating Zeke panel, popovers, sticky bars, the transfer intent header, and boxes nested inside another box (`.iso-surface .iso-surface` keeps a hairline and no shadow).
- **Reduced motion:** no transform; the shadow changes only.
- **Keyboard:** a box that contains the focused element gets `--lift-2` (`:focus-within`), so keyboard users see the same lift.
- **Ledges stay on buttons, tags and the sidebar.** Only page boxes lose them.
- **Contrast:** check text at `#FFFDFA` on `#F4EEE9` with axe. Body text stays ≥ 4.5:1, and the box edge must still be visible at 390 px.

### 1.3 Buttons and dropdowns (fixes Sky reported on 14 Oct)
- **Button heights:** `.iso-btn` 40 px by default; `.iso-btn--lg` 48 px, used once per screen for the main action. That replaces today's 52 px.
- **Dropdowns blocked by the action bar:** today the Combobox listbox (`z-index: 20`, `styles/iso-ui.css:476`) opens under the sticky `ActionBar` (`z-index: 25`, `:598`).
  - Render listboxes in a portal on `document.body`, at `z-index` 70: above sheets (60/65), below the floating Zeke's open panel only when that panel is open.
  - Flip upward when the space below is less than the list height.
  - Cap the height at the available space and scroll inside.
  - Keep keyboard and screen-reader behaviour. Add an e2e step that opens "Where this money comes from" at 390 px and clicks the last option.

### 1.4 Pages that change only by 1.1–1.3
Overview, Balance, Invoices (Pay, Check, Get paid), Zeke page, floating Zeke, History, Recipients, Rules, Settings. Same layout and words. On Balance, also confirm the 14 Oct clipping bug is gone: content sliding under the sidebar ("alance", "dd money"). If it isn't, fix it in this phase.

**Acceptance:**
- [ ] No grid on any dashboard page; the landing and the pay page are unchanged (screenshots).
- [ ] Every page box rises 3 px on hover and returns on leave, with no layout shift (`getBoundingClientRect` of the next sibling is unchanged).
- [ ] With reduced motion or a touch device, there is no movement.
- [ ] The dropdown e2e step passes at both widths.
- [ ] Buttons measure 40 / 48 px.
- [ ] axe: no new contrast failures.

---

## Phase 2 · Transfer, the new pattern (`sol/b0-p9-2-transfer`)

The payment engine, quote, approval and tracking logic stay as they are. This phase changes layout, order and words only. `TransferFlow.tsx` keeps one state machine.

### 2.1 The intent header (new `components/solana/transfer/TransferHeader.tsx`), on all five steps
- **Surface:** dark teal (`linear-gradient(135deg, #0D6370, #0A4B56)`), white text, `--lift-hero` shadow, no hover lift.
- **Top left:**
  - chips "Transfer", the status ("Draft" / "Waiting for you" / "Approved" / "On its way" / "Paid") and the gold "Test mode";
  - the title "Pay {recipient}", or "Send a payout" before a recipient is chosen;
  - a sub-line "{bank} •••• {last4} · {country} · {reference}".
- **Top right:** "Step N of 5", the step name, and five segments labelled Recipient, Amount, Route, Approve, Track.
  - Done steps are mint; the current step is coral; later steps are faint.
  - A done step before Approve is a button that goes back to it. Approve and Track never go back.
- **Metric row** (four cells, two by two at 390 px):

  | Cell | Before it's known | Once known |
  |---|---|---|
  | They receive | "Set at step 2" | the amount |
  | You pay | "Not yet", then "about US$X" at step 2 | the all-in figure from step 3 |
  | Paid out by | "Bank" | rail name (InstaPay / PESONet), or "Inside Splash" |
  | Quote | "At step 3" | "New quote in 0:48" at steps 3–4; "Locked at 57.40" at step 5 |

- Every value comes from server state. Nothing is hard-coded.

### 2.2 The page under the header
- **Layout:** two columns at ≥ 1080 px, the step on the left and a sticky **"So far"** card on the right (320 px, `top: 20px`). Below 1080 px, one column with So far after the step.
- **So far card:**
  - four rows with a tick when known: Paying, They receive, Route, Approval;
  - on step 2, also the limits box: per payment, left today after this, a bar, and "Fits your rules";
  - then the **one** primary action (48 px) and a text "Back to {previous step}" link.
- **Phone (< 860 px):** the primary action pins to the bottom of the screen (white bar, shadow, safe-area padding). The floating Zeke moves up above it.
- **Retire the full-width `ActionBar`** on Transfer steps 2–3. Its summary content moves into So far.
- **Motion:** each step enters with a 260 ms fade and a 6 px rise. Reduced motion: none. Focus moves to the step heading.

### 2.3 Each step

| Step | Heading | Content (left) | Primary action |
|---|---|---|---|
| 1 | "Who are you paying?" | `Segmented` Bank account / Splash business; saved recipients as rows (initials tile, name, bank •••• last4 · country, "Verified" or "No payout fee" tag); one click selects, double-click selects and continues; "+ New recipient" opens today's sheet (full number typed twice, call-back warning). | "Continue to amount" (disabled until one is picked, with "Pick a recipient to continue") |
| 2 | "How much?" then "What it's for" | Coupled They receive / You send fields, the rate line, the chip "Use invoice INV-xxxx · ₱amount" when the payment came from an invoice; reference, "What was bought", "How you know them", "Where this money comes from" (the dropdowns from §1.3). | "See routes and cost" |
| 3 | "Pick a route", then "Cost and where it comes from" | Bank: two lanes side by side, Cheapest and Fastest, each with tag, fee, one-line reason, a small route line (You → Lower-cost lane → Partner → bank, or You → Partner → bank) with coins moving only on the selected lane, and "You pay". "Both deliver ₱X" on the right of the heading. Splash business: one lane, "Inside Splash", no fee. Then the cost rows, "Pay from", and "How it moves" closed. | "Review and approve" |
| 4 | "Approve this payment" | No So far rail: the approval card (hero) at 1.5 fr and "Your rules · 8 of 8 pass" at 1 fr, full width. The card: "{recipient} receives", the one extruded amount, To / Route / Pay from / You pay, the quote ring, coral "Approve on this device", "Zeke drafted this payment. Zeke can't approve; only you can." Press: "Confirm with your passkey on this device…", then "Approved. Sending now.", then Track by itself. | the coral button (the only coral on the screen) |
| 5 | "On its way", then "Paid to the bank", then "Paid, with proof recorded" | The six-station tracker (Approved, Sent, With partner, Paid to bank, Recording proof, Proof recorded), driven by real state, with the coin moving only on the active segment; "In this demo the payout partner is a test partner."; the receipt (invoice, paid to, bank, they received, you paid, rate, approved by, bank reference), "Verify receipt" once the proof is recorded, then "This receipt verifies", plus "Share with auditor" and "Technical details" closed. Right rail: "What happened" (the events so far, with times) and "What's next", plus "Start a new transfer". | "Start a new transfer" (quiet) |

- **Words:** "Cheapest" and "Fastest" are labels only, with no time anywhere near them (claims test).
- "Fastest: Straight to the partner. Expected to finish first." is the one allowed comparison sentence. If `tests/claims.test.mjs` rejects "finish first", use "Straight to the partner." alone.

**Acceptance:**
- [ ] The header shows on all five steps, for both the bank and the Splash business paths (screenshots).
- [ ] Header values match server state at each step (e2e reads them).
- [ ] Back works from steps 2 and 3 and never from 4 or 5.
- [ ] On 390 px, the primary action stays reachable and never covers an open dropdown.
- [ ] Double-clicking a saved recipient lands on step 2.
- [ ] Prompt 10 §5.9 boxes still pass. Rewrite any test that pinned the old layout and list the old and new assertions in the PR.

---

## Phase 3 · Invoices chooser motion (`sol/b0-p9-3-invoices`)

The chooser (`InvoicesChooser.tsx`) and the `Morph` view transition already exist. Make them feel the way Sky showed, and check they actually run.

- **Cards:**
  - as today, with the big display title, the coin art (`token-usd` / `token-php`), the lede, live count tags and the button;
  - on the new surface (§1.2), with the `-5px` hover rise and a deeper shadow;
  - entrance: the two cards rise in 70 ms apart;
  - the coins bob 5 px on a 3.2 s loop, stopped with reduced motion.
- **Click:**
  - the clicked card grows into the hero of the page it opens (the drop zone on Pay, the requests card on Get paid) through the named `Morph`;
  - the other card fades out;
  - duration 420 ms, `cubic-bezier(.2,.7,.2,1)`.
- **Where the view transition doesn't run** (React's `ViewTransition` missing, or a browser without view transitions):
  - the clicked card scales to 1.03 with the deeper shadow for 320 ms, then navigates;
  - with reduced motion it navigates straight away.
- **Back:** the breadcrumb "Invoices" on Pay and Get paid returns to the chooser. Back there morphs the hero back into its card.
- The sidebar's Invoices item always opens the chooser (as today).

**Acceptance:**
- [ ] A screen recording (GIF) of both cards morphing in Chrome at 1440 px, and of the fallback with `startViewTransition` stubbed out.
- [ ] Reduced motion: no animation, and navigation still works.
- [ ] Keyboard: Enter on a focused card does the same thing.

---

## Phase 4 · Smart Treasury (`sol/b0-p9-4-treasury`)

Keep prompt 10 §7's back end, flows, eligibility gate, reserve guard, stock cap and evidence bundles. This phase changes the page order, adds the live view and the quarterly draft, and switches the stock partner's name.

### 4.1 Page order, top to bottom
1. **Page head:**
   - "Treasury";
   - the sub-line "Cash for payments, a reserve for what's due, and investments, all in your own accounts.";
   - quiet "Move money between accounts".
2. **All accounts:** today's section unchanged:
   - the three accounts with their art and wires (coins only while money moves);
   - the one extruded total;
   - the reserve bar, "Covered", "Floor … (10%, set by your owner)" and "Available to invest …".
3. **Test-mode ribbon**, as today.
4. **Two columns** (1fr + 320 px rail):
   - **Left: the US T-bill pool card (hero), then the stocks card.**
   - **Right rail: Hold or sweep, then Treasury activity.**
5. **Two columns:** Risk and rules (left), and the Zeke strip (right).

### 4.2 The T-bill pool card ("the third image")
- **Header:**
  - "US T-bill pool";
  - "USDY, issued by Ondo · held in your Investments account";
  - the value as the extruded number;
  - "Rate 3.75% a year · variable · set by Ondo · as of {date}", from `lib/treasury/reference.ts`, with "Rate out of date" after 35 days as today.
- **Right of the header:** "Interest today · live estimate" with a small pulsing gold dot, "+US$x.xxxx", and "about US$y a day".
  - The value and the interest tick every second while the tab is visible, and pause when it's hidden.
  - **Formula** (display only, §0.6):
    - `value_now = units × P_today × (1 + r_d)^(s / 86400)`;
    - `r_d = (1 + rate)^(1/365) − 1`;
    - `s` = seconds since 00:00 UTC;
    - `P_today` = the official price booked today (simulator in test mode).
  - `interest_today = value_now − units × P_today`.
  - `aria-live="off"` on the ticking number. A static "Interest today" is read on focus.
- **Buttons:** primary "Subscribe", quiet "Redeem". Both open today's sheets, which end in the approval moment.
- **Interest per day:**
  - a bar chart with a `Segmented` 7 days / 30 days control;
  - the bars come from daily booked prices: `units_held_that_day × (P_d − P_{d−1})`, integers, from a new `lib/treasury/history.ts` over the simulator's daily price snapshots;
  - hover or focus a bar shows "{date} · US$x";
  - date labels on the first and last bar;
  - the chart has a text summary for screen readers.
- **Under the chart:** three tiles: This period, Average a day, This quarter so far. Then: "The live figure is an estimate. Your books use Ondo's official price, set once a day."
- **"How it works" (`Details`, closed):** today's T-bill card text, moved here unchanged:
  - "A note backed by short-term US Treasury bills and bank deposits. Not a bank deposit; its value can fall.";
  - subscribe explanation; the units and price line; the hold line as verified in prompt 10;
  - "For non-US companies only.";
  - plus "Most businesses redeem once a quarter. Redeeming straight with Ondo pays US dollars by bank wire to your company's bank account, outside Splash."

### 4.3 Hold or sweep (right rail)
- `Segmented` Hold / Sweep, an owner setting as today.
  - **Hold:** "Idle cash stays in your Payments account. Zeke won't draft sweeps."
  - **Sweep:** "When cash builds above your reserve and a US$5,000 cushion, Zeke drafts a move into the T-bill pool. Nothing moves until you approve it."
- **Each draft is a row:**
  - Zeke's icon, the move ("Move US$14,987.50 in"), the reason ("Idle cash above reserve and cushion");
  - coral **"Approve"**, which **opens the approval moment** (it never approves in place), and quiet "Not now";
  - after approval: "Approved on this device";
  - after Not now: "Dismissed · Zeke will ask again next week" (no new sweep-out draft for 7 days).
- **"Fees kept inside Splash, this month"** at the bottom of the card:
  - the sum of the payout fees avoided by paying Splash businesses this month, with "N payments went to Splash businesses, so no payout fee was charged.";
  - the figure is `fee_avoided_minor`, recorded on each inside-Splash payment at quote time as the Cheapest external route's fee for the same amount (add the field and a migration);
  - nothing is estimated after the fact; payments without the field are left out, and the line says "since {date}".
  - Show the block only when the sum is above zero.

### 4.4 The quarterly interest draft (decision 10)
- Extend `lib/treasury/sweep.ts`: on the first business day after a calendar quarter ends, for companies with Sweep on, draft at most one `{ kind: 'redeem', reason: 'quarter_interest', amountMinor }`.
  - The amount is the interest booked for the quarter just ended (from `history.ts`), limited to redeemable units.
  - Its minimum is US$50 (`QUARTER_INTEREST_MIN`), not the US$500 sweep minimum.
- The daily job (`/api/cron/treasury-sweep`) writes it **in the drafted state only**, as today. It never approves or executes.
- It doesn't count against the one-draft-per-day rule for sweep-out. It does replace an older unapproved quarter draft.
- Row text: "Bring US$198.60 interest back", with the sub-line "Last quarter's interest (Jul–Sep), to your Payments account".

### 4.5 US stocks and ETFs (left column, under the T-bill card)
- Header: "US stocks and ETFs", with primary "Buy a stock or ETF".
- **Note at the top** (gold tint): "**Bought through Treasurers, our stock partner.** Treasurers sends your order to the issuer of each stock token. Each token tracks a share price; it isn't direct share ownership and pays no interest. Prices go up and down, so stocks never count toward your reserve."
- **Table:** keep today's catalogue, columns and dated sources. Rows held get "Buy more" and "Sell"; others get "Buy".
- Keep "Stocks are N% of treasury · your limit 20%" and the past-returns footnote.
- **Adapter:**
  - rename the display partner in `lib/treasury` from Ondo to Treasurers (`partnerLabel: 'Treasurers'`) and keep the simulator;
  - the issuers move into "Technical details";
  - the real Treasurers integration is out of scope (§7).

### 4.6 Rail and bottom
- **Treasury activity:** interest booked, moves in and out (with "you approved"), dated, newest first.
- **Risk and rules:** today's list, plus one line: "Stocks are bought through Treasurers. Splash fee on subscribing, redeeming, buying and selling: US$0."
- **Zeke strip:** today's text rules (Zeke never names a rate or return, and never picks an investment).

**Acceptance:**
- [ ] The order matches §4.1 at 1440 px and 390 px (screenshots, Hold and Sweep).
- [ ] The live number ticks, and pauses on a hidden tab. A test proves the float never enters money paths.
- [ ] Chart totals equal the sum of booked daily interest (integer test). Switching 7 and 30 days changes the tiles.
- [ ] Approve on a draft opens the approval moment. Nothing moves without it (e2e).
- [ ] Not now suppresses sweep-out drafts for 7 days (fake clock).
- [ ] The quarterly draft appears once on the first business day after the quarter ends, at or above US$50, drafted only (fake clock, tests).
- [ ] "Fees kept inside Splash" equals the sum of `fee_avoided_minor`, and is hidden at zero.
- [ ] The claims test passes: "Treasurers" only where allowed, no web address, no "via Ondo" on stocks, no "yield" / "APR" / "earn" / "auto-sweep".

---

## Phase 5 · Independent check (`sol/b0-p9-5-check`)

1. **Re-shoot** every screen from Phase 0 into `docs/design/p9/after/`. Put before and after side by side in `docs/design/p9/COMPARE.md`.
2. **Independent review:** run a separate review agent that has not seen the work. It reads this prompt and the after screenshots and lists every mismatch. Fix or explain each one in the PR.
3. **Run §0.5 in full.** Paste the results.
4. **Motion audit:** every movement in Phases 1–4 has a reduced-motion state, and nothing moves on its own except the coins on a moving wire, the coin bob on the chooser, the live dot and ticking number on Treasury, and the quote ring.

## 6. Done means
All phase boxes are ticked with evidence, the final PR is open into `sol/b0-p8-7-check` (or `sol/b0-p8-design`), and the README "Not verified yet" list is updated. Then send Sky one message: what changed, the PR link, and the before/after page.

## 7. Out of scope and gates
- A real Treasurers integration and contract (gate: signed agreement).
- Real Ondo onboarding.
- Any live investment before Malaysian counsel signs off (K17, K18).
- Showing the T-bill rate or the stocks table in a public demo (the G4 gate in the demo script).
- Automatic sweeps of any kind. Every move needs a person (decision 9).
- Changes to the payment engine, routing or the approval cryptography.
