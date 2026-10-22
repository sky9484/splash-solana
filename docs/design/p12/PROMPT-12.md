# Splash Solana build prompt 12: new landing, sign-in pages, working capital, step 5 receipt and auditor PDF, and the audit fixes

**Written:** 18 Oct 2026, 07:30 MYT. **For:** Claude Code, run on Sky's computer in `sky9484/splash-solana`.
**Builds on:** Sky's restyle branch `origin/sol/b0-p9-6-restyle` @ `6a65016` (16 Oct). That branch sits on `sol/b0-p9-5-check`, not on `sol/b0-p9-base`, and has no PR yet. This prompt merges it into one stack (§0.3).
**Canon:** Business Module v15.1 + Amendment 01 (D17 pricing: US$149/month + 0.10% per payout, US$2 minimum, partner cost at cost on its own line). If canon and this prompt disagree, canon wins: stop and ask Sky.
**Approved preview:** the "Splash · final preview" artifact, version 8 (https://claude.ai/artifact/CyHjdGpmMjUg7KFQjmWwKG). A copy ships with the asset pack as `docs/design/p12/preview.html`. It is a Vite/React mock, not app code. Copy its layout, sizes, spacing, motion and words, **except where §0.5 overrides the words**. Never paste its code.
**Audit this prompt fixes:** `splash/dashboard-audit_after-prompt-11_2026-10-18.md` (project doc; a copy ships in the pack as `docs/design/p12/AUDIT.md`).
**Image decisions:** `splash/image-prompts_landing-auth_2026-10-18.md` (rounds 1–4).

---

## Sky's decisions (18 Oct, all CONFIRMED)

| # | Decision | Sky said |
|---|---|---|
| 1 | **Page colours.** Sign in, Sign up, Forgot password, Reset password, Verify email and every `/admin` page use **Pale**. The landing, `/working-capital`, the dashboard and the shared receipt use **Paper**. | "on login page and admin page keep the 'Pale' as background colour. the rest of the page like landing page and dashboard page use 'paper'" · "the /admin page i mean" |
| 2 | **Landing hero:** one pinned story in five beats on desktop (island, then images E1–E4), ending on "Payments are the feature. Proof is the product." | 18 Oct preview round 1–2 |
| 3 | **Phones get their own hero**, not a shrunk desktop one: the hero block, then the four beats as swipe cards with small images. | "make the image smaller to fit the screen for mobile, or make the design differently for smaller device" |
| 4 | Hero beat 02 uses Sky's new image (hand on fingerprint, 8 tiles, no button). | "use the grok-image-e514b7c9… image for 02 · A person approves on hero section. it's okay no button." |
| 5 | Sign-in uses the **night** desk image. | "night version" |
| 6 | **Routes:** the image sits straight on the page, not in a box. The tiles below use the Start-sending button colour and rise on hover to show more. | 18 Oct round 1 |
| 7 | **Comparison:** less text, no "where it runs today", better alignment, no Wise: the third column is "Other B2B platforms". | 18 Oct round 1 |
| 8 | **Working capital:** no extruded type. Clear, modern, fintech standard, in the dashboard language. Footer untouched. | "no extruded text style; fintech standard, clear and modern" |
| 9 | **Step 5:** the receipt card as previewed ("nice"). Download PDF gives the Splash receipt with every transaction and proof detail. | "nice" |
| 10 | **Share with auditor** opens a sheet. It offers the e-invoice portal for the business's country (MyInvois for Malaysia, BIR EIS for the Philippines, Coretax for Indonesia), marked Planned, plus a verify link and the evidence file. Outside those countries: the PDF and a link. | 18 Oct round 1 |
| 11 | **Auditor receipt** (A4, TIME table) and the **monthly statement**, as previewed. | "superb", "love the TIME table" |
| 12 | **The payment card** in the closing band "Move money better" is Sky's generated image, the only image allowed to carry text. | "it's okay to have flag, amount text and everything. only this one okay" |
| 13 | **New Southeast Asia band** with the region map; Malaysia → Philippines "Sandbox today", the other corridors "Roadmap". | final preview, 07:15 |
| 14 | **Footer and the isometric display type stay as they are.** | "do not change isometric typography footer design" |
| 15 | No image appears twice across the landing, the sign-in pages and the dashboard. | "no repeated images incl landing & dashboard" |

## Decisions this prompt makes for Sky (DEFAULT — Sky can overrule any of them in the PR)

These came up while checking the preview against the repo. Each one keeps a test green or a claim true. List them in the final PR under "Defaults taken".

| # | Default | Why |
|---|---|---|
| D1 | **Loop 02 "Keep" uses `/cinematic/treasury-island.png`**, not `loop-save-v3.png` as in the preview. | `loop-save-v3.png` is on `BANNED_ART` in `tests/claims.test.mjs` (idle USD rising at a "variable" rate reads as a yield). The preview was wrong. After this prompt `treasury-island.png` is no longer used on Forgot/Reset/Verify, so it's free. |
| D2 | **Platform 03 "Approval" shows an icon tile, not a picture**, until Sky supplies `public/isometric/gen/platform-03-device-key.webp` (prompt P3 in §2.7). | In the preview it used `treasury-island.png` (now loop 02). Every unused image in the repo is either banned, has a baked background, or shows an Ethereum-style coin (`flow-settle-v4.png`). |
| D3 | **Reset password reuses image D** (mailbox), and **Verify email reuses image C** (new desk). | Each is the next screen of the same flow. Sky can ask for two more images later. |
| D4 | **Working capital "Where Supply fits" shows no images.** | Its three images would repeat the landing's three loops (decision 15). |
| D5 | **The landing never writes "Fastest" in its own copy.** Route chips say "Cheapest" and "Straight to the partner". | The claims test bans "fastest" as a speed ranking outside engine keys. The dashboard keeps the engine's labels. |
| D6 | **The evidence pack stays one JSON file** ("Evidence file"). The ZIP shown in the preview is not built. | The repo has no zip library, and adding a dependency for this is not worth it. The A4 receipt is the printable page. |
| D7 | **Auditor links expire after 90 days**, as the preview says. Links made before this prompt keep working (no expiry), and the owner can stop sharing any link. | The preview promises "Expires in 90 days". Old links can't be broken silently. |
| D8 | **No Splash email goes to an auditor's address.** "Send a verify link" = copy link + a `mailto:` draft. | Sending mail to third-party addresses from the product is a new abuse surface and needs its own review. |
| D9 | **The landing keeps its partner rail, Trust section and control-plane reveal**, restyled. | The preview left them out, but Sky never asked to remove them, and Trust carries the "not yet licensed" sentence. |
| D10 | **The coded payment card from the preview is not built for the landing.** | Sky chose the generated image (decision 12). |

---

You are working in `sky9484/splash-solana`. Read this whole prompt before changing anything. Work phase by phase. A box is ticked only when you saw it pass, and the evidence (screenshot path, test name, command output) is in that phase's PR. Anything you couldn't verify goes in README "Not verified yet".

## 0. Ground rules

### 0.1 Read first
- `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `HANDOVER.md`, `STATUS.md`.
- **Next.js 16:** read `node_modules/next/dist/docs/` for anything you touch: `not-found`, `error`, `loading`, metadata, `next/image`, route segment config. Heed deprecations.
- Prompt 11: in the asset pack as `docs/design/p12/PROMPT-11.md`. Its §0 rules still apply unless this prompt changes them.
- Source:
  - `styles/tokens.css`, `styles/iso-ui.css`, `styles/cinematic.css`, `styles/landing.css`, `app/globals.css`
  - `components/IsometricLanding.tsx` and `components/landing/*`. The landing's real styles are `app/globals.css` (the `.iso-landing` block and the extruded `.iso-display` type) and `styles/cinematic.css`. `components/IsometricLanding.module.css` is imported nowhere, so don't edit it. `styles/landing.css` styles only the legacy `components/landing/Landing.tsx`, which supplies `LANDING_FAQ`.
  - `components/auth/*`, `app/{login,signup,forgot-password,reset-password,verify-email}/page.tsx`, `app/loading.tsx`, `components/SplashLoading.tsx`, `app/error.tsx`
  - `app/working-capital/page.tsx`, `components/supply/*`
  - `components/solana/transfer/StepTrack.tsx`, `components/solana/ReceiptView.tsx`, `components/solana/SharedReceipt.tsx`, `app/receipt/[token]/page.tsx`, `app/dashboard/receipts/[id]/page.tsx`
  - `lib/solana-app/shared-receipt.ts`, `lib/solana-app/service.ts` (`shareReceipt`, `openShare`, `receiptView`), `lib/solana-app/pack-response.ts`
  - `lib/dashboard/nav.ts`, `components/dashboard/*`, `app/admin/(console)/layout.tsx`, `app/admin/login/page.tsx`
- Tests that pin what you'll change:
  - `tests/landing-and-numbers.test.mjs`: landing section order, the four step titles, the footer tech line, design discipline (no all-caps eyebrows, no → on buttons, no " · " strings, reduced motion, focus-visible, no raw hex in `styles/landing.css`)
  - `tests/claims.test.mjs`: banned words, `BANNED_ART`
  - `tests/image-optimizer-allowlist.test.mjs`: every raster path exists under `public/` and matches `images.localPatterns`
  - `tests/iso-tokens.test.mjs`, `tests/dashboard-contrast.test.mjs`: the ground colour
  - `tests/oxwal-frontend.test.mjs`: lines ~156 and ~169 read `components/landing/SettlementCinematic.tsx` and assert `hero-district-v\d+.png` in it
  - `tests/admin-contrast.test.mjs`: pins the admin page `[237,244,242]`, its sidebar gradient, the admin sign-in panel and the loader cream `[248,240,229]` from `app/loading.tsx`
  - `tests/queue-contrast.test.mjs`: pins `/queue` (this prompt leaves `/queue` alone)
  - `tests/motion-audit.test.mjs`: its `ALLOWED` list of things that may loop by themselves
  - `tests/solana-company.test.mjs`: the behaviour tests for `shareReceipt` (around lines 170–173)
  - `tests/receipt-share.test.mjs`: the **legacy** share (`lib/server/receipt-share.ts`, `components/Receipt.tsx`, and the non-`shr_` branch of `app/receipt/[token]/page.tsx`). It must stay green, so don't remove that branch.
  - `scripts/check-jargon.mjs`: the baseline is 1, and it scans `components/solana`, `app/receipt` and `app/dashboard`
  - `tests/solana-ui.e2e.mjs`: the walkthrough, currently broken by the restyle (audit B7)

### 0.2 Toolchain and skills
- Node `>=24.11 <25`, npm `>=11`. Run `node -v` first; stop if it's wrong.
- **Load before starting, and list loaded and missing ones in every PR:**
  - mandatory per `AGENTS.md`: `ui-ux-pro-max`, `isometric-typography-designer`, `frontend-design`, `design-taste-frontend`;
  - also: `motion-web-designer`, `canva-figma-design`, `web-artifacts-builder` (reading the preview only), `payments-treasury-expert`, `fintech-architect`, `fintech-security-compliance`, `agentic-finance-expert`, `qa-verification-engineer`.
- If a mandatory skill is missing, say so in the PR and continue. Don't silently skip it.

### 0.3 Branches and PRs
1. `git fetch`.
2. `git checkout -b sol/b0-p12-base origin/sol/b0-p9-6-restyle`.
3. `git merge --no-ff origin/sol/b0-p9-base -m "Prompt 12 base: Sky's restyle on top of the prompt 11 stack"`. If it conflicts, stop and tell Sky. Don't resolve it by guessing.
4. Push `sol/b0-p12-base`.
5. One branch and one PR per phase, each into `sol/b0-p12-base`:
   - `sol/b0-p12-0-before`
   - `sol/b0-p12-1-ground`
   - `sol/b0-p12-2-landing`
   - `sol/b0-p12-3-auth`
   - `sol/b0-p12-4-working-capital`
   - `sol/b0-p12-5-receipts`
   - `sol/b0-p12-6-dashboard-fixes`
   - `sol/b0-p12-7-check`
6. At the end, open one PR from `sol/b0-p12-base` into `sol/b0-p9-base`.
   - Before opening it, check whether prompt 11's PRs #26–#31 have been merged into `sol/b0-p9-base`. If they haven't, this PR will also show prompt 11's six phase commits (`9cc3337`…`0658d3a`).
   - Its description lists exactly what it carries: prompt 11 (if still unmerged), Sky's five restyle commits (`61b8d0a`…`6a65016`), and prompt 12.
   - Ask Sky to merge #26–#31 first if he wants a clean diff.
7. Never commit to or push `main` or `build/solana-colosseum`. Never force-push.
8. Commit trailer:
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   ```

### 0.4 Assets (Sky provides these; check them before Phase 2)
Sky unzips `splash-prompt-12-assets.zip` at the repo root. It adds:

- **`public/isometric/gen/`**: 13 WebP images, already cut out (transparent except the night image) and sized for 2× screens. Admitted by the existing `"/isometric/**"` pattern, so `next.config.ts` doesn't change.

  | File | Size (px) | Goes to |
  |---|---|---|
  | `hero-01-zeke-reads-invoice.webp` | 892×831 | Hero beat 01 |
  | `hero-02-person-approves.webp` | 960×818 | Hero beat 02 (decision 4) |
  | `hero-03-two-routes.webp` | 960×608 | Hero beat 03 |
  | `hero-04-receipt-proof.webp` | 728×935 | Hero beat 04 |
  | `how-01-vault-keys.webp` | 900×927 | How it works 01 |
  | `how-02-ranked-by-pesos.webp` | 900×902 | How it works 02 |
  | `how-03-person-approves.webp` | 900×690 | How it works 03 |
  | `how-04-proof-saved.webp` | 900×677 | How it works 04 |
  | `auth-signin-night.webp` | 1200×900 | Sign in. Opaque, dark `#022938` background. |
  | `auth-signup-new-desk.webp` | 800×608 | Sign up, Verify email |
  | `auth-forgot-mailbox.webp` | 800×716 | Forgot password, Reset password |
  | `close-payment-card.webp` | 559×1056 | Closing band "Move money better" |
  | `region-sea-map.webp` | 1400×950 | Southeast Asia band |

- **`docs/design/p12/`**:
  - `preview.html`: the approved preview, open it in a browser;
  - `preview-src.zip`: its source, for reading copy and sizes only; never import it;
  - `AUDIT.md`;
  - `IMAGES.md`: the image doc;
  - `SHA256SUMS`.

Run `cd public/isometric/gen && shasum -a 256 -c ../../../docs/design/p12/SHA256SUMS`. All 13 must pass. If any file is missing or fails, stop and ask Sky.

Use `next/image` with explicit `width`/`height` from the table, `sizes` set for each layout, and `alt=""` for decorative art. The payment card and the region map get real alt text (§2). Only the hero's first beat image is `priority`.

### 0.5 Copy rules: the preview's words, with these changes
The preview breaks repo rules in places. **The repo's tests win.** Apply all of these in every file this prompt touches:

1. **No `→` on any button or link.** The preview has them on almost every CTA.
2. **No " · " joined strings in copy.**
   - Put each part in its own element: a number chip and a label, a tag and a value.
   - Eyebrows like "01 · An invoice arrives" become a number chip `01` plus the label "An invoice arrives".
   - Tags like "Cheapest · US$12.50" become a tag "Cheapest" plus the value.
   - Two footers stay **exactly** as they are, middle dot included:
     - the landing footer's sanctioned line, "Settlement on Solana · Evidence encrypted with Seal, stored on Walrus";
     - the working-capital footer line, "Supply loop: roadmap · Settle loop: sandbox on Solana devnet" (decisions 8 and 14).
3. **No all-caps eyebrows and no mono labels.**
   - The preview's uppercase mono kickers become sentence case, Geist 700, 12.5 px, letter-spacing 0, colour `--kick`, with the gold dash in front.
   - Mono stays only for real identifiers: receipt id, payment id, fingerprint, bank reference.
4. **No emoji.** Use `lucide-react` icons:
   - ✉ → `Mail`
   - 🔒 → `Lock`
   - ✓ → `Check`
   - 🏛️ → `Landmark`
   - 🔗 → `Link2`
   - the file icon → `FileJson`
5. **These exact replacements:**

   | Where | Preview says | Ship this |
   |---|---|---|
   | Hero beat 03 lede | "Cheapest or Fastest, ranked by what the supplier receives. Dollars travel as USDC to the payout partner, who pays the bank in pesos." | "Two routes, ranked by what the supplier receives, with both fees shown before you choose. Dollars travel as USDC to the payout partner, who pays the bank in pesos." |
   | Hero beat 03 float card | tags "Cheapest · US$12.50", "Fastest · US$19.00" | Tag "Cheapest" + "US$12.50 in fees"; tag "Straight to the partner" + "same ₱287,000.00". No second fee figure: US$19.00 was invented, and it sits above the engine's 0.33% all-in target. |
   | How it works 02 tag | "Current checkpoint · Cheapest · Fastest" | "Both fees shown first" |
   | How it works, every step tag | "Current checkpoint · {stat}" | just `{stat}` |
   | Southeast Asia band lede | "…adds a corridor only when a licensed payout partner is signed for it." | "…adds a corridor only when a payout partner for that country is signed and the controls are ready." |
   | Routes, tags | "PHP · sandbox", "IDR · next", "VND · later" | one tag: "Philippines, in sandbox". The roadmap lives in the Southeast Asia band. |
   | Routes tile "You pay" | "Converted amount plus a 0.25% all-in fee, shown before you approve." | "US$5,000.00 converted, plus US$12.50 in fees, shown before you approve." |
   | Comparison, Splash fee cell | "0.10% + US$2 min" | `lockedCopy.fee` (content/claims.ts) |
   | Comparison "Idle cash", Splash | "Reserve + T-bill pool" | "Reserve, with a treasury option in test mode" |
   | Comparison bank/broker/platform fee cells | "3–5% typical", "2–4% typical", "0.5–1.5%" | keep today's `comparisonRows` values ("3-5%", "2-4%", "0.5-1.5%"). Don't invent new numbers. |

6. **Still banned everywhere** (prompt 11 §0.4, `tests/claims.test.mjs`):
   - "licensed" (except its negations), "instant", "guaranteed", "autonomous", "yield", "APY", "APR", "earn", "faster";
   - any delivery time or speed figure;
   - partner names (PDAX, Coins.ph);
   - "Fastest" in landing or auth copy (D5);
   - "Walrus", "Seal", "payment intent", "on-chain", "attestation" on marketing routes, except the sanctioned lines.
7. **Numbers.**
   - Every number in new landing copy is either one of the demo transfer's numbers or comes from `content/claims.ts` / `content/sea-numbers.ts`.
   - The demo numbers: US$5,000.00, US$12.50 (= US$5.00 Splash at 0.10% + US$7.50 partner), US$5,012.50, ₱287,000.00, 57.40, 60 seconds.
   - Illustrative identifiers also allowed: "BDO •••• 4471", "line 12", the receipt number `SPL-R-20261018-6512F659` (the §5.1 format), and the working-capital INV-4471 card figures (Phase 4).
   - "Eight rules" stays only while Step 3's "Passed 8 of 8 rules" (`lib/solana-app/service.ts`, around line 1321) still counts eight. Count them. If the count differs, use the real count in the copy and tell Sky that image E2 shows 8 tiles.

### 0.6 Design system rules (all phases)
- **Token scope.** This matters more than anything else in this section.
  - The dashboard tokens (`--cyan`, `--on-cyan`, `--mint`, `--paper`, `--lift-1/2`, `--ground`, `--amber-fill`, and the `.iso` value of `--teal`) exist **only inside `.iso { }`** in `styles/tokens.css`.
  - The landing (`.iso-landing`), the auth pages (`.iso-auth`), working capital, the shared receipt, 404 and error are **not** `.iso` roots. On them `--teal` is the `:root` value `#5C9EAD`. White text on that is about 3:1, which fails §0.6's contrast rule.
  - Don't opt those pages into `.iso`: the names collide, and `tests/iso-tokens.test.mjs` guards against that.
  - Instead, add one new scope block to `styles/tokens.css`, `.sp-page { … }`, put the class `sp-page` on those page roots, and give it **prefixed** tokens:

    | Token | Value |
    |---|---|
    | `--sp-paper` | `#FFFAF4` |
    | `--sp-paper-2` | `#F3EBE0` |
    | `--sp-pale` | `#EFF4F3` |
    | `--sp-pale-2` | `#E1E9E8` |
    | `--sp-surface` | `#FFFFFF` |
    | `--sp-ink` | `#0C3E48` |
    | `--sp-deep` | `#083640` |
    | `--sp-teal` | `#0D6370` |
    | `--sp-cyan` | `#0C5763` |
    | `--sp-on-cyan` | `#F1F8F6` |
    | `--sp-on-cyan-2` | `#CDE6E1` |
    | `--sp-mint` | `#9FCFC7` |
    | `--sp-mint-wash` | `#DDEFEA` |
    | `--sp-gold` | `#EFC46F` |
    | `--sp-coral` | `#E39774` |
    | `--sp-coral-ink` | `#9F4F2C` |
    | `--sp-amber-fill` | `#FBEFDD` |
    | `--sp-kick` | `#0D6370` |
    | `--sp-auth-night` | `#022938` |
    | `--sp-text-2` | `rgb(12 62 72 / .86)` |
    | `--sp-muted` | `rgb(12 62 72 / .55)` |
    | `--sp-lift-1` | `0 1px 2px rgb(8 54 64 / .06), 0 10px 24px -12px rgb(8 54 64 / .26)` |
    | `--sp-lift-2` | `0 2px 4px rgb(8 54 64 / .07), 0 22px 40px -14px rgb(8 54 64 / .34)` |
    | `--sp-ease` | `cubic-bezier(.2, .7, .2, 1)` |
    | `--sp-t-ui` | `180ms` |
    | `--sp-t-beat` | `400ms` |
    | `--sp-t-art` | `500ms` |
    | `--sp-t-sheet` | `320ms` |

  - **The rule for the rest of this prompt:** a token written without a prefix (for example `--cyan`, `--kick`, `--ease`, `--lift-2`) means the `.iso` token on dashboard pages, and the `--sp-` token of the same name everywhere else.
  - Never use the `:root` `--teal` for text or buttons on the new pages.
- **Durations live in CSS, never in TSX strings.**
  - A string like `'opacity 400ms'` in a `.tsx` file trips the claims speed rule (`\d+\s?ms`) and the landing test's ban on `ms` figures in the hero source.
  - Use classes and the `--sp-t-*` / `--t-*` tokens.
  - The same goes for "300 ms" in the loader: it is a CSS `animation-delay`, or a constant in a `.ts` file outside `app/`, `components/` and `content/`.
- **Tokens only.** New colours go in `styles/tokens.css` (and the `.iso` block for dashboard files), never as raw hex in components or `styles/landing.css`. `check-iso-ui` must stay green.
- **Boxes:**
  - 30 px radius for cards, 20 px for inner blocks;
  - lift = prompt 11's `--lift-1`, hover `--lift-2` + `translateY(-3px)`, 180 ms, `--ease`;
  - no borders on floating boxes.
- **Dark cyan** `--cyan #0C5763` with `--on-cyan` text for hero bands, the auth art panel, How it works, the closing band and route tiles. Solid, no gradients on boxes.
- **Display type:**
  - The extruded isometric display type is the existing `.iso-display` in `app/globals.css`: upper case, stepped shadows. It is part of decision 14, so keep it exactly as it is, upper case included, and don't copy the preview's `.disp` rules.
  - It is for the **landing only**: hero headlines, section headlines and the closing band.
  - "No all-caps" in §0.5.3 means labels and eyebrows, not this display type.
  - Working capital, auth and dashboard use clean type (Geist 800, sentence case, the accent words in `--teal`).
  - The footer is untouched.
- **Motion:**
  - One orchestrated moment per page: the landing's pinned story; the auth art fading up when the page changes (500 ms); the share sheet sliding up.
  - Hover lifts are allowed.
  - No fade-on-scroll on every section, and no `IntersectionObserver` reveal (the landing test bans it).
  - Every motion has a `prefers-reduced-motion: reduce` state with no movement.
  - Anything that loops by itself must be added to `ALLOWED` in `tests/motion-audit.test.mjs` with its reason. That means the loader's bob and pulse and the landing's token and bridge bobs if they are in `.iso` styles. Don't add anything else.
- **Accessibility:**
  - visible `:focus-visible` on everything that can be clicked;
  - 44 px minimum touch targets on phones;
  - text contrast ≥ 4.5:1 (body) and ≥ 3:1 (≥ 24 px);
  - `role`/`aria` as in the preview (tabs, radio group in the share sheet, `aria-current` on story steps).
- **Phones:** check every page at 390 px. No sideways scrolling: use `overflow-x: clip`, never `hidden`, because `hidden` breaks sticky positioning.

### 0.7 Checks before every push
- `npm run test:claims`
- `npm run test:solana`
- `npm run test:auth`
- `npm test`
- `npx tsc --noEmit -p tsconfig.json`
- `npm run lint` (all checks, including `check-iso-ui`, `check-jargon` with the jargon count not rising, `check-copy`, `check-numbers`)
- `npm run build`
- From Phase 1 on: `tests/solana-ui.e2e.mjs` at 1440 px and 390 px. Phase 1 fixes it (audit B7, §1.3).
  - Run it **exactly as its header says**: its own dev database on port 5434, then `NEXT_DIST_DIR=.next-e2e DATABASE_URL=postgres://postgres@127.0.0.1:5434/postgres?sslmode=disable SPLASH_SOLANA_MODE=offline npx next dev -p 3200`, then `BASE_URL=http://localhost:3200 node --test tests/solana-ui.e2e.mjs`.
  - Don't run it under `next start`: in production mode the dev staff login fails closed, and the walk ends in the staff console.
  - Restart the dev database before each run.
  - `next dev` adds the `.next-e2e` folders to `tsconfig.json`'s `include`. Restore that before committing.

### 0.8 Money and security
- Integers only, through `lib/money.ts`. The receipt, statement and step 5 card render ledger values. Nothing is recomputed for display except formatting.
- No secrets, mnemonics, private keys or API keys in code, logs, screenshots or commits. Screenshots use the seeded demo company only.
- The auditor link opens one receipt read-only. It never reveals other receipts, the dashboard, or the company's account details beyond what the receipt shows.

---

## Phase 0 · Before pictures (`sol/b0-p12-0-before`, no app code)
1. Build and run the app with the seeded demo company.
2. Screenshot at 1440 px and 390 px into `docs/design/p12/before/`:
   - landing, full page plus each hero beat;
   - `/working-capital`;
   - login, signup, forgot, reset, verify email;
   - loader, 404 (`/nope`), the error page;
   - transfer step 5 after a payment;
   - `/dashboard/receipts/[id]` and the shared `/receipt/[token]`;
   - `/admin` and `/admin/login`;
   - and every page in audit section A.
3. Run `tests/solana-ui.e2e.mjs` and record that it fails at the sidebar assertion (audit B7). The failure is the "before".
4. Put the asset pack in (§0.4), verify the checksums and commit it in this PR as a separate commit, "Prompt 12 assets (Sky)".

## Phase 1 · Paper and Pale grounds (`sol/b0-p12-1-ground`)

### 1.1 Tokens (`styles/tokens.css`)
- **Dashboard (`.iso` block): Paper.**
  - `--ground: #FFFAF4` and a new `--ground-2: #F3EBE0`.
  - The page background is `linear-gradient(180deg, var(--ground), var(--ground-2))`, fixed to the viewport. This is the ground the preview showed and Sky approved; boxes stay solid.
  - **Boxes become `#FFFFFF`** (`.iso` `--surface`), because a near-paper box on paper disappears. Keep `--lift-1`, so the shadow carries the separation.
- **Non-`.iso` pages:** the `.sp-page` block from §0.6. Paper pages use `--sp-paper` → `--sp-paper-2`; auth and admin use `--sp-pale` → `--sp-pale-2`, same gradient.
- Update the pinned values with "(Sky, 18 Oct)" comments:
  - `tests/iso-tokens.test.mjs`: `token('ground')` is `#FFFAF4` (line ~107), and `token('surface')` is `#FFFFFF` (line ~108, today `#FFFDFA`).
  - `tests/dashboard-contrast.test.mjs`: test against **both** gradient ends `[255,250,244]` and `[243,235,224]`, plus the new white box fill. Every surface must still be found and every text colour must still pass.
- The pay page `--ground-grid` stays.

### 1.2 Where each ground goes
- **Paper:** `/`, `/working-capital`, `/trust`, `/dashboard/**`, `/receipt/[token]` (the `shr_` branch), 404, error.
- **Unchanged:** `/pay/[slug]` keeps its `--ground-grid` and grid. `/queue` keeps `bg-[#F6F0ED]`, which `tests/queue-contrast.test.mjs` pins.
- **Pale:**
  - `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`;
  - `/admin/login` and the whole `/admin/(console)` shell. A class alone won't do it:
    - `app/globals.css` (~7304) has `.fintech-admin-shell { background: #edf4f2 !important }`. Change that rule to the Pale gradient.
    - `.fintech-admin-shell::before` (~5404) draws a 28 px grid. Remove it.
    - Remove the Tailwind `bg-[linear-gradient(...),#EEF4F5]` in `app/admin/(console)/layout.tsx` too.
  - The admin sidebar keeps its painted gradient (`#245563 → #0c3039`, globals.css ~5423) unchanged.
  - Drop the admin sidebar's uppercase group titles to sentence case (§0.5.3).
  - Update `tests/admin-contrast.test.mjs` deliberately: the page colour becomes both Pale ends, and every check must still pass. Add the comment "(Sky, 18 Oct)".
- `/onboarding/**` and `/settings/**`: Paper.

### 1.3 Fix the walkthrough now (audit B7)
`tests/solana-ui.e2e.mjs` ~233 expects `Control|Rules|Zeke`. Rules moved into Settings with the restyle.
- Change the expected groups to `['Overview', 'Pay|Transfer|Invoices|Batch payout', 'Money|Balance|Treasury|History', 'Contacts|Recipients', 'Control|Zeke']`.
- Reach Rules through Settings and assert it there.
- Run the walkthrough (§0.7). It must pass at the end of this phase and stay green after every later phase.

**Done when:**
- every route above shows the right ground in screenshots;
- the contrast tests (dashboard, admin, queue untouched) and the token tests pass;
- no page shows a grid except `/pay/[slug]`;
- the walkthrough is green.

## Phase 2 · Landing (`sol/b0-p12-2-landing`)
Work in `components/IsometricLanding.tsx`. Put every new landing style in a new file, `styles/landing-p12.css`, imported in `app/globals.css` right after `cinematic.css`. It uses `--sp-*` tokens only, with no raw hex. Only touch `.iso-landing` rules in `globals.css` to delete what the new sections replace. Replace `components/landing/SettlementCinematic.tsx` with a new `components/landing/HeroStory.tsx` (desktop) and `components/landing/HeroStoryPhone.tsx` (phone). Keep the `isPhone` server decision from `app/page.tsx` so the right hero arrives on the first byte, and use the CSS width query as a backstop. `SettlementCinematic.tsx` is deleted only after every test that reads it points at `HeroStory.tsx`:
- the `"Pay suppliers abroad."` assertion in `tests/landing-and-numbers.test.mjs`;
- `tests/oxwal-frontend.test.mjs` ~156 (the `readFile`) and ~169 (`/hero-district-v\d+\.png/`; `HeroStory.tsx` keeps `hero-district-v5.png` on beat 0).

### 2.1 New section order (update `tests/landing-and-numbers.test.mjs` deliberately)
1. hero
2. `#loops`
3. partner rail (D9)
4. `#how-it-works`
5. `#platform`
6. `#corridors`, now **its own section** ("Routes", decision 6)
7. `#region` (new)
8. `#comparison`
9. `#trust` (D9)
10. `#copilot` with `#control-plane` inside it
11. closing band
12. footer (unchanged)

Rewrite the structure assertions in the landing test to this order, and replace the "corridors must not be its own section" assertion with "corridors is its own section, after platform". Keep every truth assertion unchanged:
- the four step titles, including the sanctioned `'Proof saved: encrypted on Walrus, anchored on Solana'` string;
- the footer line;
- the banned lists;
- the `/working-capital` link;
- no Sui, MemWal or DeepBook.

Point the design-discipline test at the new files too: `HeroStory.tsx`, `HeroStoryPhone.tsx`, `IsometricLanding.tsx` and `styles/landing-p12.css`.
- **The TSX files:** no → on buttons, no " · " (apart from the footer line), no `\d+ms` strings.
- **`landing-p12.css`:** no uppercase, no mono, no raw hex, and `prefers-reduced-motion` and `:focus-visible` present.
- Don't point it at `app/globals.css`: it carries 285 legacy hex values and the protected `.iso-display` upper case.

### 2.2 Hero, desktop (`HeroStory.tsx`) — matches preview tab 1
- A section `420vh` tall with a sticky stage `100vh` inside it.
- Grid: `minmax(0,1fr) minmax(0,1.15fr)`, max width 1180, 24 px gutter.
- A progress bar on top.
- A step rail of five buttons on the left edge, with `aria-current="step"`, hidden below 1320 px.
- **Five beats.** The beat index is `floor(progress × 5)`, where progress comes from a passive scroll listener with `requestAnimationFrame` (not IntersectionObserver).
  - **Copy:** each beat crossfades: opacity plus `translateY(±22px)`, 400/500 ms.
  - **Art:** it scales from 0.92 and moves `±16px`.
- **The beats:**

  | # | Label chip | Headline (extruded) | Accent line | Art | Extra |
  |---|---|---|---|---|---|
  | 0 | Pay suppliers abroad | Pay / suppliers / abroad. | Prove every payment. | `/cinematic/hero-district-v5.png`, with the USD and PHP tokens bobbing | Both CTAs: "Open payment desk" and "See how it works" |
  | 1 | 01, An invoice arrives | Zeke reads / the invoice. | You check it. | `hero-01` | Float card "Check the invoice", tag "From line 12", Amount ₱287,000.00, Bank BDO •••• 4471 |
  | 2 | 02, A person approves | Zeke drafts. / A person approves. | On your device. | `hero-02` | Float card: Rules "8 of 8 pass" (§0.5.7), You pay US$5,012.50, coral button "Approve on this device" (inert, `tabIndex={-1}`, `aria-hidden`) |
  | 3 | 03, Two routes | Two routes. / Same pesos. | You pick. | `hero-03` | Float card with the two route tags from §0.5.5 and a two-dot rail |
  | 4 | 04, The product | Payments are / the feature. | Proof is the product. | `hero-04` | Float card SPL-R-20261018-6512F659 "Verifies", They received ₱287,000.00, You paid US$5,012.50. CTAs: "Open payment desk", "Verify a sample receipt". |

- Ledes are word for word from the preview, with §0.5 applied.
- Reduced motion: no pinning. The five beats stack as plain sections.
- Hero art max height `min(56vh, 440px)`, drop shadow `0 18px 22px rgb(12 62 72 / .16)`.

### 2.3 Hero, phones (`HeroStoryPhone.tsx`) — decision 3, preview at 390 px
- **No pinned scroll.**
- **Hero block:** label chip, then the extruded headline at `clamp(34px, 10.5vw, 44px)`, then the lede (14.5 px), then two full-width buttons, then the hero district image, max width 320 px.
- **Under it**, the heading "How a payment goes" with a "1 / 4" counter.
- **The rail:** a horizontal rail with scroll-snap (`x mandatory`) and four cards:
  - 84% width, 30 px radius, white;
  - art 150 px high, `object-fit: contain`;
  - the label chip, then the title in clean type (20 px, 800, accent words in teal), then the lede (13.5 px);
  - the last card has "Verify a sample receipt".
- **Dots under the rail:**
  - buttons with a 24 px hit area and `role="tab"`;
  - the active dot stretches to 22 px wide;
  - tapping one scrolls to its card;
  - the counter follows the scroll position.
- No float cards on phones.

### 2.4 The three loops (`#loops`)
- Same Paper ground as every section; remove the peach radial wash (audit C).
- **The loops:**
  - 01 Settle: `/isometric/loop-settle-v4.png`;
  - 02 Keep: `/cinematic/treasury-island.png` (D1);
  - 03 Supply: `/isometric/loop-supply.png`, links `/working-capital`.
- Status tags: Live, Live, Roadmap.

### 2.5 How it works (`#how-it-works`), dark cyan band
- Left: the headline "Four steps. One record." (extruded, light), then four step buttons (`.stepbtn`, `aria-current`).
- Right: a white card. Image 270 px max, `riseIn` on change. Number chip and title under it.
- **Images:** 01 `how-01`, 02 `how-02`, 03 `how-03`, 04 `how-04`.
- `flowSteps` keeps its titles and the sanctioned step-04 description string. Only `image`, `width` and `height` change, plus the step tags (§0.5.5).

### 2.6 Platform (`#platform`)
- 01 Vault: `liquidity-pools.png`.
- 02 Settlement: `settlement-machine.png`.
- 03 Approval: an **icon tile** (D2): a 120 px mint-wash square, 20 px radius, `lucide ShieldCheck` 44 px in `--teal`, centred where the image would be.
- Keep the copy. Turn the `meta` strings "Your vault - your approval" into two tags each.

### 2.7 Prompt P3, for Sky (put it in the PR description, not in code)
> P3 · Platform "Approval". Paste the shared style block (image-prompts doc) first. A dark-teal vault door with one keyhole, standing on a cream isometric tile. A phone lying face-up on a small teal pedestal in front of it shows a mint key shape on its screen; a thin mint line runs from the phone to the keyhole. To the left, a small friendly rounded teal robot holds a clipboard with a draft sheet and stands back, not touching the phone or the door. No hand, no fingerprint, no coins, no text. Mood: one device holds the key.

When Sky adds the P3 image, the swap is one line. Leave a comment at the icon tile saying so, but **don't write the image path in quotes in the comment**. `tests/image-optimizer-allowlist.test.mjs` matches quoted raster paths in comments too, and would fail until the file exists. Write "platform-03-device-key, webp, under isometric/gen".

### 2.8 Routes (`#corridors`), its own section
- **Left column:**
  - label chip "Routes" with the sub-label "The first corridor";
  - extruded headline "USDC in. / Pesos out.";
  - lede: "Malaysia to the Philippines is the sandbox corridor. Indonesia follows when a payout partner and the controls are ready.";
  - one tag (§0.5.5);
  - a dark button "Open the payout desk".
- **Right column:** `corridor-bridge-v3.png` straight on the page, no box, max width 620, gentle 6 s bob (none with reduced motion).
- **Four route tiles under it**, in dark cyan, the Start-sending button's colour:

  | Label | Value | Revealed on hover |
  |---|---|---|
  | They receive | ₱287,000.00 | The full invoice amount. The supplier never pays a landing fee. |
  | You pay | US$5,012.50 | §0.5.5 text |
  | Rate | 57.40 | Locked for 60 seconds from the quote. Test rate in the sandbox. |
  | Paid out by | PESONet | Any Philippine bank. InstaPay for smaller amounts. |

- **Tile behaviour:**
  - the hover line is hidden by default;
  - on hover the tile rises 6 px with `--lift-2` and the line grows from `max-height:0` to 80 px with opacity 1;
  - the same happens on `:focus-visible` (tiles are `tabIndex={0}`);
  - on touch devices the line is always shown.

### 2.9 Southeast Asia (`#region`), new, decision 13
- **Grid:** `.9fr 1.3fr`.
- **Left column:**
  - label chip "Southeast Asia";
  - clean headline (not extruded) "Built for the trade between **our neighbours.**", with the accent in teal;
  - the lede from §0.5.5;
  - a corridor list of five pill rows, max width 360.
- **The corridor rows:**
  - "MY → PH": dark cyan, with "Sandbox today" in gold;
  - "MY → ID", "MY → TH", "MY → VN", "MY → SG": white, with "Roadmap" muted.
  - The arrow inside a corridor code is data, not a button, so §0.5.1 doesn't apply. Render it as `MY` + an `aria-label="to"` arrow icon (`lucide ArrowRight` 14 px) + `PH`.
- **Right column:** `region-sea-map.webp`, alt "Isometric map of Southeast Asian landmarks linked by payment routes".
- **Phones:** the image goes on top.
- **Corridor source:** read the rows from one array in `content/claims.ts` (`corridors: [{ from: 'MY', to: 'PH', status: 'sandbox' }, …]`) so the status lives in one place. `'live-corridor'` in `content/sea-numbers.ts` stays `1`.

### 2.10 Comparison (`#comparison`)
- **Head:** "Built for business. / Designed to move." (extruded), plus the lede from the preview.
- **Table:** `table-layout: fixed`, first column 22%, Splash column highlighted in `--cyan` with `--on-cyan` text. Columns: Bank wire, Broker / remitter, Other B2B platforms, Splash.
- **Rows** (eight, from the preview, §0.5.5 applied):
  1. Who holds the money
  2. Fee
  3. Rate
  4. Supplier bank check
  5. Approval
  6. Batch
  7. Receipt
  8. Idle cash
- **Rename the data key:** `wise` → `platform` everywhere.
- **Under the table**, the small note: "Typical published ranges, not quotes. Splash is in sandbox; no real money moves. Treasury is in test mode until legal sign-off."
- **Phones:** the table scrolls sideways inside its own wrapper. The page itself doesn't.

### 2.11 Trust, copilot, closing
- **Trust (`#trust`):** keep its content. Surfaces to the new boxes; no uppercase.
- **Copilot (`#copilot`):**
  - the preview's Zeke strip: `copilot-desk.png` in a white card on the left, "Zeke prepares. You approve." (extruded, ink) on the right, plus the four tags Reader / Router / Checker / Auditor;
  - keep the control-plane reveal (`aria-controls="control-plane"`, `ctrlOpen ?`) under it, restyled.
- **Closing band:** dark cyan, two columns.
  - Left: label chip "Move money better", the extruded headline "Pay the supplier. **Keep the proof.**", one line of copy, then "Start sending" (gold) and "Log in" (ghost).
  - Right: `close-payment-card.webp`, max height 480, drop shadow `-14px 22px 26px rgb(0 0 0 / .28)`, rises 8 px on hover.
  - Alt: "Example payment: you send US$5,012.50 from Malaysia; the supplier receives PHP 287,000.00 in the Philippines; delivered to the bank; fees US$12.50; the receipt verifies."
  - Phones: one column, card max height 340.
- **Footer:** unchanged (decision 14).

### 2.12 No repeats (decision 15)
After this phase, each raster image is used by at most one of: landing, auth pages, dashboard. Add `tests/no-repeat-art.test.mjs`:
- It collects raster paths per surface (landing = `components/IsometricLanding.tsx` + `components/landing/**`; auth = `components/auth/**` + the five auth pages; dashboard = `app/dashboard/**` + `components/solana/**` + `components/dashboard/**`).
- It fails if any path appears on two surfaces.
- Allowed exceptions, listed in the test with reasons:
  - the brand mark and the token coins (`token-*.png`);
  - `agent-bot-cut.png` (Zeke's avatar, dashboard only).
- Repeats within one surface (D3's two auth images) aren't checked; that is intended.

**Done when:**
- the landing matches the preview at 1440 and 390 px, with each hero beat screenshotted;
- the landing test is rewritten and green;
- `no-repeat-art` is green;
- no image from `BANNED_ART` is referenced.

## Phase 3 · Auth pages, loader, 404, error (`sol/b0-p12-3-auth`)

### 3.1 One shell for all five auth pages
Rebuild `components/auth/IsometricAuthShell.tsx`, and move `LoginForm` into it so login uses the same shell. The layout matches preview tab 2:

- **Page and card:** Pale ground; a centred white card, 30 px radius, `--lift-2`, max width 1120; two columns `1.05fr 1fr`; on phones the art panel stacks on top.
- **Left art panel:** dark cyan, 36 px padding, three rows:
  1. the wordmark (light) plus the line "Pay suppliers abroad. Prove every payment.";
  2. the image, max 400 × 300, fades up 500 ms when the page changes;
  3. a lead line (20 px, 800) plus three gold-check points: "Your vault, your keys", "A person approves every payment", "One record per payment".
- **Remove:** the 24 px grid (`iso-auth-grid`), the caps mono labels, "USD SETTLEMENT INFRASTRUCTURE", and the repeated landing art (`settlement-machine.png`, `treasury-island.png`, `splash-finance.svg` on these pages).
- **Per page:**

  | Page | Image | Panel colour | Lead line (from the preview) |
  |---|---|---|---|
  | Sign in | `auth-signin-night.webp` | `#022938` (token `--auth-night`). The image fills the panel width with a radial mask `ellipse 66% 64% at 50% 52%, #000 45%, transparent 100%`, so no edge shows. | Invoice, approval, transfer and rate, kept together for the auditor. |
  | Sign up | `auth-signup-new-desk.webp` | `--cyan` | Keys made in your browser. Nobody at Splash can move the money. |
  | Forgot password | `auth-forgot-mailbox.webp` | `--cyan` | The password opens the desk. The vault stays locked until you approve on your device. |
  | Reset password | `auth-forgot-mailbox.webp` (D3) | `--cyan` | Same as forgot. |
  | Verify email | `auth-signup-new-desk.webp` (D3) | `--cyan` | Same as sign up. |

- **Right form panel** (cream `--paper`, 48 px padding):
  - label chip, then H1 (30 px, 800), then sub;
  - fields 30 px radius, 48 px high, with a leading `lucide` icon;
  - primary button 48 px high in `--teal`, no arrow.
  - **Keep every existing form behaviour exactly:** Google sign-in, passkey, validation, error messages, rate-limit handling, redirects, `PasswordFromLinkForm`, "Keep me signed in for 30 days", sign-up fields and terms checkbox.
  - **This phase changes the look, not the auth logic.** `npm run test:auth` must pass unchanged.

### 3.2 Loader (`app/loading.tsx` + `components/SplashLoading.tsx`)
As preview tab 2's loader:
- a white card on the page's ground;
- the droplet mark bobbing with the USD token;
- the wordmark;
- three status lines that tick as the real steps finish (session, approvers, what needs you);
- a three-dot pulse.

Rules:
- No percentage and no fake progress. The lines follow real steps where the loader knows them; otherwise one line, "Opening your desk".
- Show it only after 300 ms, so quick loads never flash it.
- Reduced motion: no bob, no pulse.
- Remove `settlement-machine.png` from the loader.
- The loader's loop goes in `tests/motion-audit.test.mjs` `ALLOWED` if it lives in `.iso` styles.
- Update the loader colour in `tests/admin-contrast.test.mjs` (`[248,240,229]` today) to the new card colour, deliberately.

### 3.3 404 (new `app/not-found.tsx`) and error (`app/error.tsx`)
- Paper ground, one white card.
- **404:**
  - H1 "This page isn't here";
  - one line: "The link may be old, or the page moved.";
  - buttons "Go to your desk" (signed in) or "Go to Splash" (signed out), plus "Contact support".
- **Error:**
  - keep its logic and the "Try again" reset;
  - same card;
  - show the error digest in mono, for support.
- Neither page uses an image (no repeats).

**Done when:**
- all five auth pages, the loader, 404 and error match at 1440 and 390 px;
- `test:auth` passes;
- the walkthrough signs in through the new login;
- the no-repeat test is green.

## Phase 4 · Working capital (`sol/b0-p12-4-working-capital`)
Rebuild `app/working-capital/page.tsx` as preview tab 3: Paper ground, dashboard language, clean type only (decision 8). Footer untouched.

1. **Top nav:** wordmark, "Back to Splash" (quiet), "Start sending" (dark).
2. **Hero band (dark cyan, 36 px):**
   - Left:
     - label chip "Supply loop, roadmap" + coral tag "Coming capability, subject to licensing". "Licensing" is allowed; "licensed" isn't.
     - H1 "Your invoices are **working capital.**" at `clamp(36px, 4.8vw, 64px)`, accent in teal-light `--mint`.
     - The lede from the preview.
     - Gold button "Register financing interest" and ghost button "See live settlement first".
     - Three facts: Funded by / Rail / Control.
   - Right: a white card for INV-4471.
     - A two-way switch: Hold to maturity / Take early payment.
     - Rows: Settles, Supplier receives, Discount.
     - The coral note.
     - Tags: Buyer-funded, No lender, Approval-gated, Illustrative.
   - **The illustration numbers** (US$100,000; 1.2%; US$98,800; US$1,200; "about 4.9% a year") must say **"Illustrative"** next to them. Compute them in integer minor units with `lib/money.ts`, not floats.
   - The "a year" figure is a buyer saving, not a return to Splash or the supplier. Phrase it exactly as in the preview: "Buyer saves (illustrative) … about 4.9% a year." It must pass `test:claims` (no "yield", no "APR", no "earn"). If it doesn't, drop the "a year" figure and tell Sky.
3. **Section 01, The receivable:** three cards with `wc-receivable-1..3.png`, the copy from the preview, and the tags.
4. **Section 02, Buyer-funded discounting:** three cards with `wc-discount-1..3.png`.
5. **Section 03, Where Supply fits:**
   - three text cards: Settle (Live), Supply (Roadmap), Save (Live), with **no images** (D4);
   - each card keeps its copy and a foot tag;
   - Save's copy: "Idle US dollars wait in your own account. Your business approves every move."
   - Remove "projected, variable treasury posture" from Save's copy. It reads as a return.
6. **Closing band:** "Early interest decides **which corridor is first.**", the disclaimer, and two buttons.
7. **Remove:** the pale-grey chapter dividers, the giant 01/02/03 watermarks, the grid background and the square ledged cards (audit C). Headings are `h2` in sentence case with the accent words in teal. Eyebrows follow §0.5.3.

**Done when:** it matches at 1440 and 390 px, claims and number checks are green, and "Register financing interest" still does what it does today. Don't change its handler.

## Phase 5 · Step 5, the receipt, the auditor sheet, the A4 PDF and the monthly statement (`sol/b0-p12-5-receipts`)

### 5.1 Receipt number (display only)
Add `receiptNumber(receiptId, issuedAt)` in `lib/solana-app/`:
- Format: `SPL-R-YYYYMMDD-XXXXXXXX`, using the first 8 hex characters after `rcpt_` in the receipt id (ids are `rcpt_` + 16 hex, made with `randomHex(8)`), upper case, and the issue date in MYT (UTC+8).
- It is display only. The receipt id stays the key for lookup, verify and share.
- Unit-test it: deterministic, MYT date boundary at 23:59/00:00 UTC+8, upper-cased.

### 5.2 Step 5 receipt card (`components/solana/transfer/StepTrack.tsx`) — preview tab 4
- **Keep:** the dark intent header, and the tracker of six stations (Approved, Sent, With partner, Paid to bank, Recording proof, Proof recorded) driven by real state.
- **The card becomes a document:**
  - **Top row:** a "Receipt" label, the receipt number (20 px, 900), the company name, and the date and time in MYT. On the right, a status tag: "Proof recorded" (ok) or "Recording proof".
  - **Three amount blocks:** "Supplier received" (dark cyan), "You paid", "Rate". Each has a one-line sub: the rail and bank reference; converted plus fee; PHP per US$, test rate, and the lock time.
  - **A two-column list of label/value rows**, each value right-aligned and allowed to wrap **under its own value**, never under the label (audit B1):
    - Paid to: name, bank •••• last 4, country, "verified by call-back {date}";
    - Invoice;
    - Purpose;
    - Route: the engine label. Use the view's existing `policyLabel` (service.ts ~1368); `POLICY_LABEL` isn't exported.
    - Approved by: name, role, then "approved on device ab12…" (short form). Don't write a "Device key" label: `check-jargon`'s baseline is 1, and it would rise.
    - Bank reference;
    - Splash payment id: mono, with a copy button.
  - **One action row at the bottom, in this order:**
    1. "Verify receipt" (primary);
    2. "Share with auditor" (opens §5.3);
    3. "Download PDF" (opens §5.4 and prints);
    4. "Full receipt" (link).
  - Verify and Share stay disabled with the existing reason until the proof is recorded (§5.8 of prompt 10, unchanged).

### 5.3 Share-with-auditor sheet (decision 10)
Use the existing `Sheet` component as it behaves today (a side sheet on desktop, a bottom sheet on phones), with focus trapped. It closes on Esc and returns focus to the button.

- **Header:** "Share this receipt", with a sub naming the receipt number.
- **Country row:** a segmented control MY / PH / ID / Other.
  - Default is the business's country from its KYB or onboarding profile. If the Solana org has none, the default is **MY** (every company today pays from Malaysia).
  - The person can change it. The change is not saved.
- **Options** (a radio group, one selected):
  1. **e-Invoice portal** (MY, PH, ID only), with a gold tag **"Planned"**. The button is disabled; the sheet shows what it would need. Texts from the preview:
     - MY: "Send to MyInvois as a self-billed e-Invoice". Note: the buyer issues a self-billed e-Invoice when paying a foreign supplier; it needs LHDN API onboarding and the supplier's TIN.
     - PH: "Send to the BIR e-Invoicing System".
     - ID: "Prepare for Coretax (e-Faktur)".
     - Nothing is sent to any government system in this prompt.
  2. **Verify link:** "Copy a read-only link". It creates or reuses the share (existing `shareReceipt`) and copies the URL. A second button, "Email it", opens a `mailto:` draft with the subject "Payment receipt {number}" and the link in the body (D8). Below it: "Read-only. Opens this receipt and nothing else. Expires in 90 days." Once a share exists, a "Stop sharing" button sets `revokedAt`. After that the old link shows the "not valid" page.
     - Creating a share stays open to any member, as today.
     - Revoking needs `isOwner || session.userRole === 'admin'`, the same rule as `mayRevealBankNumbers` in `lib/server/bank-details.ts` (~98).
     - Other members see the button disabled, with "Only an owner or admin can stop sharing."
  3. **PDF:** "Download the receipt (PDF)". Same as §5.4.
  4. **Evidence file:** "Download the evidence file (JSON)", the existing pack (D6).
- **Country "Other":** only options 2–4, with the note "Your country's e-invoice portal isn't covered yet. Send the PDF and the link."

**Backend for D7** (`ShareRecord` is in `lib/solana-app/doc-store.ts` ~23; `shareReceipt` and `openShare` are in `lib/solana-app/service.ts` ~440–455):
- Add optional `expiresAt?: string`. `shareReceipt` sets it to `createdAt + 90 days` for new shares.
- `openShare` throws the existing `receipt_not_found` error **with its existing message** when `expiresAt` is in the past. By design it says nothing about why (service.ts ~450), so don't add an "expired" message.
- Return `expiresAt` (or `null`) from `/api/solana/shared/[token]`, so the shared page can show "Expires {date}".
- Shares without `expiresAt`, made before this prompt, keep working.
- Shares live in the JSON doc store (`lib/solana-app/doc-store.ts`), so no migration is needed. Confirm that, and say so in the PR.
- **Reuse rule:** `shareReceipt` reuses an existing share only if it is neither revoked nor expired.
- Add the revoke route if one doesn't exist: `POST /api/solana/receipts/[id]/share/revoke`. It uses the share route's session and company checks, plus the owner-or-admin rule above, and is idempotent.
- **Tests** go in `tests/solana-company.test.mjs`, next to the existing `shareReceipt` tests. `tests/receipt-share.test.mjs` covers the legacy share; leave it as it is and keep it green. expiry at the boundary (89 d 23 h opens, 90 d + 1 s refuses), old shares without `expiresAt` open, revoke works and is idempotent, a revoked or expired share is not reused, and a non-owner cannot revoke.

### 5.4 The A4 receipt / PDF (decision 11) — preview tab 5
One printable page for "Download PDF", the shared `/receipt/[token]` page and `/dashboard/receipts/[id]`. The design is the same everywhere; the shared page has no dashboard shell.

- **Build** a `components/solana/ReceiptDocument.tsx` used by `ReceiptView` (company) and `SharedReceipt` (auditor). It replaces the old 2025 look (audit A).
- **Layout (A4, 210 × 297 mm, 14 mm margins):**
  - **Header:** brand mark and "Splash", "Payment receipt", the receipt number, "issued {date}", and in test mode the line "Test mode: simulated, no real money moved".
  - **Seal**, top right: "Verified", "proof recorded", date, time in MYT. Shown only when the proof is recorded **and** the browser check has passed; otherwise "Not yet verified".
  - **Two blocks:** Paid by (company, city/state/country from the profile, payments account short id) and Paid to (name, bank •••• last 4, country, "Bank details verified by call-back, {date}").
  - **Three amount blocks:** Supplier received (dark cyan; amount, currency name, rail, bank reference), You paid (converted + fee, with the fee split Splash / partner as the ledger has it), Rate (PHP per US$, test rate, lock time).
  - **References table:** Supplier invoice, Purchase order (if any), Purpose, Route, Splash payment id, Approver (name, role, "approved on device ab12…").
  - **Jargon:** words like "device key", "hash", "anchored", "Solana" or "USDC" in visible labels raise the `check-jargon` count. The proof block (fingerprint, root) goes in a file marked `// copy: technical`, like the existing Technical details.
  - **The time table (Sky's favourite).** Columns: Event, Time (MYT), By, Evidence.
    - Rows come **only from real recorded events**, in order: invoice read and draft, rules checked (real count passed / total), approved, sent from the Payments account, received by the payout partner, paid to bank, proof recorded.
    - If an event has no recorded time, that row isn't shown. Never invent a time.
  - **How to check:**
    - **When a share exists**, a QR code for its verify URL. Use the existing `qrcode` package's `toString(url, { type: 'svg' })`; it works in the browser, and these are client components. No external service.
    - **On the company copy with no share yet**, no QR. Show "To let someone outside your company check this receipt, use Share with auditor." Printing never creates a share by itself.
    - The URL in mono, and the paragraph from the preview ("Your browser recomputes… The server supplies the record, never the answer."). Also the fingerprint and root in mono.
  - **Footer:**
    - in test mode, "Splash is in sandbox and is not yet a licensed money-services business. This receipt describes a simulated payment on a test network." Live mode drops that last sentence; the first stays until the licence changes.
    - Page numbers through `@page { @bottom-right { content: "Page " counter(page) " of " counter(pages) } }`. Browsers without margin boxes simply show none; don't fake them.
    - In test mode, a diagonal "Test mode" watermark at 5% opacity.
- **Print:**
  - Extend the existing `@media print` block in `styles/iso-ui.css`: only the document prints, `@page { size: A4; margin: 14mm }`, no shadows, colours kept (`print-color-adjust: exact`), break-inside avoid on blocks and table rows.
  - "Download PDF" calls `window.print()` with the document in view, and the file is named through `document.title = "Splash receipt {number}"`.
- **Shared page (`/receipt/[token]`, the `shr_` branch only).** The legacy non-`shr_` branch (`findReceiptShare`, `<Receipt>`, `notFound()`) stays as it is; `tests/receipt-share.test.mjs` pins it.
  - Paper ground, the document, and one live "Verify" button.
  - Read-only tags: "Verify live", "Read-only", "Expires {date}" (or "No expiry" for old links).
  - No sidebar, no account data beyond the document.
  - An expired or revoked token shows the existing not-valid page in the new 404 style.

### 5.5 Monthly statement (decision 11)
- **Where:** a "Monthly statement" button on History (`/dashboard/history`), with a month picker (default: last full month) and an account picker (Payments / Treasury / All).
- **Route:** opens `/dashboard/history/statement?month=YYYY-MM&account=…`, a printable A4 page in the same style as §5.4.
  - **Header:** company, month, account, and a "Test mode" line if applicable.
  - **Summary:** opening balance, money in, payments out, fees, interest booked (Treasury only, labelled "Interest booked", never "earned"), moves between your accounts, closing balance.
  - **Table:** date (MYT), description, receipt number (linked), amount in, amount out, balance after.
  - **Footer:** the line "The accountant posts from this statement and each line's receipt."
- **Data:** read only from the existing ledger and history services. No new store.
- **Test** that opening + in − out − fees + interest ± moves = closing, **in integer minor units**, for the seeded company and for an empty month.
- **Empty month:** "No activity in {month}". Still printable, still shows opening = closing.
- **Months:** only months the company existed in can be chosen.

**Done when:**
- step 5, the sheet (all four countries), the A4 receipt (company and shared), print preview and the statement are screenshotted at 1440 px, plus 390 px for step 5, the sheet and the shared page;
- the receipt-share tests and the statement balance test are green;
- the old receipt design is gone from `/dashboard/receipts/[id]` and the `shr_` shared page.

## Phase 6 · Dashboard fixes from the audit (`sol/b0-p12-6-dashboard-fixes`)
Paper ground and the new boxes everywhere. Keep logic and copy unless an item says otherwise.

### 6.1 Pages still on the old design (audit A)
- **Recipients:**
  - Rebuild it as a list of saved recipients with: name, bank •••• last 4, country, "verified by call-back {date}" or "Not verified" (coral dot), last paid date and amount.
  - "New recipient" opens the Transfer recipient sheet.
  - Remove: "Global directory", "Corridor mix" with made-up percentages, "Compliance check", "Quick actions", "Beneficiary stats", and "Payment status and history live in History" (B12).
  - The "No recipients found" text appears only when there really are none; today it shows while two suppliers have been paid. Fix the query.
- **Batch payout:**
  - new surfaces and table style, no caps eyebrow;
  - replace the native `<select>` "Rehearse a problem (offline only)" with the iso `Combobox` (B11).
- **Settings tabs:**
  - the Invoices tab style replaces the dark navy pills;
  - no caps eyebrow;
  - Devices: text at normal size, and the yellow banner becomes an `--amber-fill` note.
- **History:** Invoices tab style, no caps "MONEY" eyebrow.

### 6.2 Restyled pages, flaws (audit B)

| # | Fix |
|---|---|
| B2 | Zeke page: the chat gets a fixed height (`min(64vh, 560px)`) with the log scrolling inside; the right column sets the row height. |
| B3 | Treasury "Interest per day": show the chart only once there is at least one day of data. Until then, one line: "Interest shows here after your first full day." |
| B4 | Treasury activity: every row shows the time (MYT) and the destination account. |
| B5 | Overview "Needs you": optional set-up (second approver) is not a need. Move it to the setup card. |
| B6 | Sidebar "Account setup N of 6": hide the box once every **required** step is done. |
| B8 | Top row rate pill: keep "USD → PHP 57.40 test rate"; drop "USD → IDR next corridor". |
| B9 | Invoices chooser: the coin's cream halo must not show on dark cyan. Use a cut-out coin or put the card's own colour behind it. |
| B10 | Balance "Add money" cards: one button style per row (all primary ledge or all quiet, whichever the preview shows for that row). |

**Done when:** every row above has a before/after screenshot pair, and `dashboard-contrast` and `check-iso-ui` are green.

## Phase 7 · Check (`sol/b0-p12-7-check`)
1. **Extend the walkthrough** (fixed in Phase 1). Add steps for: the new login, step 5's share sheet (open, switch country, copy link), the A4 receipt, the shared page, the statement, the 404, and the landing's phone hero swipe.
   - Run it at 1440 and 390 px. It must pass.
2. **Re-shoot** every Phase 0 screen into `docs/design/p12/after/`, and put them side by side in `docs/design/p12/COMPARE.md`.
3. **Independent review:** a separate review agent that has not seen the work reads this prompt, the preview and the after screenshots, and lists every mismatch. Fix or explain each one in the PR.
4. **Claims sweep:** grep the whole diff for every word in §0.5.6, for `→` on buttons and for " · " in landing/auth/working-capital copy. Paste the empty result.
5. **Motion audit:** list every animation added. Each has a reduced-motion state. Nothing moves by itself except:
   - the existing `ALLOWED` entries in `tests/motion-audit.test.mjs`: the moving wires and their coins, the tracker coin, the Invoices chooser bob, Treasury's live dot;
   - plus this prompt's additions: the hero tokens' bob, the bridge bob, the loader.
   - `motion-audit` must be green, with the additions listed in `ALLOWED` with reasons.
6. **Run §0.7 in full** and paste the results.

## 8. Done means
- Every phase box is ticked with evidence.
- The final PR from `sol/b0-p12-base` into `sol/b0-p9-base` is open, with:
  - "Defaults taken" (D1–D10);
  - prompt P3;
  - the skills list.
- README "Not verified yet" is updated.

Then send Sky one message: what changed, the PR link, the before/after page, and any default he should look at first.

## 9. Out of scope and gates
- Sending anything to MyInvois, BIR EIS or Coretax. Those options stay "Planned" until LHDN/BIR/DJP onboarding, a counsel check and the supplier TIN capture are done.
- Emailing auditors from Splash (D8).
- A ZIP evidence pack or a server-side PDF library (D6).
- Changes to the payment engine, routing, fees, the approval cryptography, KYB or the auth logic.
- Any new corridor going live. The Southeast Asia band is roadmap only.
- New images beyond the 13 in the pack. P3 and any regenerations are Sky's.
