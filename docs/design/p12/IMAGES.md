# Image prompts for the landing and auth pages (Grok Imagine / Gemini)

**Written:** 18 Oct 2026. **Use:** paste the style block, then one image prompt, then the negative prompt. Generate 3–4 variations each; keep the one whose camera matches the existing art. Eight images: E1–E4 (hero beats), A (How it works 01), B (sign in), C (sign up), D (forgot password). Everything else on the landing reuses art already in the repo (see `dashboard-audit_after-prompt-11_2026-10-18.md`, section C).

## Style block (paste before every prompt)

Isometric 3D illustration in a clean vector style with soft cel shading. True isometric camera (30°, no perspective distortion), the object sits on a thin cream isometric tile with a soft contact shadow. Thin dark-teal outlines (#083640). Palette, in this order of use: deep teal #0C3E48, teal #0D6370, mint #9FCFC7, cream #FFFAF4, warm sand #ECE5D8, gold #EFC46F for coins and one highlight only, coral #E39774 for a single small accent at most. Light from the top-left, matte materials, no gloss, no glow, no lens flare, no neon, no purple or blue gradients. No text, no letters, no numbers, no logos, no watermark. Small stylised figures are fine; no realistic faces. Transparent background (or flat cream #FFFAF4 if transparency is not available). Square-ish composition with breathing room on all sides, 1600 × 1200.

## Negative prompt (paste after every prompt)

photorealistic, glossy render, neon, purple, blue gradient, text, letters, numbers, logo, watermark, blurry, perspective camera, fisheye, lens flare, clutter, busy background, dark mood, people with detailed faces

## E1 · The invoice is read

**Where:** Landing hero · beat 01 “Zeke reads the invoice”

A paper invoice slides out of an open envelope onto a small isometric reading desk. Above the desk, a friendly rounded teal robot with a single square head and two simple dot eyes leans over the paper and points at one line with a slim pointer; three lines on the invoice are highlighted in mint as if picked out. Beside the desk, a small phone stands upright showing a mint tick. No coins in this scene. Mood: calm, careful, “reading”.

## E2 · The approval on a device

**Where:** Landing hero · beat 02 “A person approves”

A phone stands upright on an isometric tile. On its screen a single large coral button sits at the bottom with a small mint fingerprint glyph above it. A stylised hand (simple, no face) reaches in from the right and presses the button with one finger. Next to the phone, a small padlock has just turned open; behind it eight tiny mint check tiles stand in a neat row like dominoes. No coins, no paper. Mood: one decisive human action.

## E3 · The route to the bank

**Where:** Landing hero · beat 03 “Two routes, same pesos”

Two isometric lanes run from a small vault on the left (a dark-teal cube with a round door and a thin gold trim) to a small bank building on the right (cream façade, teal roof, a round peso-coin sign shape with no letters). The lower lane is longer and passes through a small toll-booth-style station in the middle; gold coins roll along this lane. The upper lane is shorter and straight, with no coins. A tiny mint flag stands by the lower lane and a tiny gold flag by the upper one. Mood: a choice between two roads.

## E4 · The receipt that proves itself

**Where:** Landing hero · beat 04 “Proof is the product”

A tall receipt sheet stands upright on an isometric tile, slightly curled at the top. Near its bottom a round stamp mark is pressed into it: a circle containing a bold check mark, in teal. Under the tile, three small dark-teal blocks are linked by a short chain, like a tiny ledger. A magnifying glass leans against the receipt. One gold coin rests at the base. Mood: settled, verifiable, finished.

## A · Keys cut in the browser

**Where:** How it works · 01 Your vault

An isometric browser window (a flat rounded rectangle with three dots in its top bar) floats above a tile, and from it a slim key drops toward a dark-teal vault door below. The vault door has two keyholes side by side; one key is already in the left keyhole, the second key is on its way down. A tiny tag on a cord hangs from the second key. Beside the vault, a small empty key ring lies on the tile to say “no third key”. No coins. Mood: ownership, made here, not handed over.

## B · The approver’s desk at night

**Where:** Sign in page

A compact isometric office desk at night: a laptop with a soft mint rectangle on its screen (a prompt, no text), a phone face-up beside it, a small desk lamp casting warm light, a cup. From the laptop a very thin wire runs along the desk edge to a miniature bank building at the corner, and one gold coin sits on the wire halfway. The room around the desk is dark teal, the desk itself cream. Mood: quiet, ready, one person in control.

## C · A new desk being set up

**Where:** Sign up page

A new isometric workspace tile being assembled: a dark-teal vault door still resting on a small trolley, a blank cream nameplate leaning against it, a rolled-up map tied with a mint ribbon, a stack of empty receipt frames, and a toolbox open with a tiny spanner. A small friendly rounded teal robot carries one more crate in. Nothing is filled in yet. Mood: first day, builder’s energy, optimism.

## D · The reset link arrives

**Where:** Forgot password page

An isometric cream mailbox on a short post stands on a tile; a sealed envelope with a small key-shaped tag on a cord is arriving along a thin wire into the mailbox slot. Behind the mailbox, a dark-teal vault door stays firmly shut with its wheel turned. No coins anywhere. Mood: calm recovery, the money untouched.

## After generation, in Canva

In Canva: import each PNG, keep the 30° isometric alignment by snapping the tile edge to a 24 px grid, never rotate; if a background slipped in, remove it with Background remover and re-export PNG at 1600 × 1200 with transparency. Recolour stray hues with the Splash palette only. Export: PNG, transparent, 2×.

## Rules
- Never a logo, wordmark or any text inside a generated image; copy lives in the page.
- One home per image; the ledger in the audit doc says where each goes.
- Keep the transparent PNG and the Canva source; export at 1600 × 1200.
- These are illustrations of the product, not claims: no rate numbers, no speed, no partner names.
## Status after generation (18 Oct 2026, 05:15)

**Background decision (Sky, confirmed):** login, sign-up, forgot password and the admin pages use **Pale** (`#EFF4F3` → `#E1E9E8`). The landing, working-capital and dashboard pages use **Paper** (`#FFFAF4` → `#F3EBE0`). The preview locks these per tab; the colour switcher is removed.

**Generated images received, cleaned (trimmed, transparent) and placed in preview v3:**

| ID | File | Goes to | Verdict |
|---|---|---|---|
| E1 | `E1-zeke-reads-invoice_v2.png` | Hero beat 01 | **v2 accepted (05:44)**: pointer stick, highlighted lines. Pen problem fixed. |
| E2 | `E2-person-approves_v2.png` | Hero beat 02 | **v2 accepted (05:44)**: blank coral button. Still 6 check tiles, not 8. Copy says "Eight rules": add two tiles in Canva. |
| E3 | `E3-two-routes.png` | Hero beat 03 | Use. A "$" sign appears on the bank (minor). |
| E4 | `E4-receipt-proof.png` | Hero beat 04 | Use. |
| A | `A-vault-keys.png` | How it works 01 | Use. |
| B | `B-signin-desk-night.jpg` | Sign in | **Sky chose the night version (05:44).** The sign-in panel takes the image's colour `#022938`; the edges are feathered. |
| C | `C-signup-new-desk.png` | Sign up | Use. |
| D | `D-forgot-mailbox.png` | Forgot password | Use. |

**Repo destination (prompt 12):** `public/art/gen/<id>.webp`, around 640 px wide, served with `next/image`; keep the PNG masters outside the repo.

## Round 2 (18 Oct, 05:44): Sky's answers and new prompts

**Answers (CONFIRMED):**
- **Phones:** the hero is redesigned, not shrunk. Below 700 px, the pinned five-beat scroll is replaced by a hero block (headline, two full-width buttons, island) and then "How a payment goes": beats 01–04 as swipe cards (84% width, 150 px art, scroll-snap, dots).
- **E1 and E2:** Sky's v2 images are in. E2 still needs 8 tiles.
- **Sign in:** night image.
- **Pale pages** = sign in, sign up, forgot password and **`/admin`**. Everything else, Settings included, is Paper.

**Closing band "Move money better":** built in code, not as a generated image. It is a true 30° isometric card made with a CSS matrix and a solid extruded edge, using the transfer demo numbers: you send US$5,012.50 from Malaysia (your own vault); the supplier receives ₱287,000.00 at BDO •••• 4471, Philippines; Delivered to the bank; fees US$12.50 (Splash US$5.00 + partner at cost, per D17); receipt SPL-R-0415 verifies. This frees `bridge` so it appears only in Routes.

Why the reference card was not copied as-is:
- It shows "2 min 34 sec", a delivery time, which the claims rules forbid.
- It shows "Fee 0.8%", which is 8× the 0.10% canon rate and above the ≤0.33% all-in target.
- It labels the amount "USD" where we use "US$".
- AI-rendered numbers come out garbled, and they can't be changed per corridor.

Prompt M (a blank slab) exists only if a generated card body is wanted later, with the text added on top in code.

## H2 · Ranked by what arrives

**Where:** How it works · 02 “Best route by pesos received”

Two clear glass measuring cylinders stand side by side on an isometric tile. A small spout above each pours round gold coins (plain faces, no symbols) into it. The left cylinder is filled noticeably higher than the right, and a mint ribbon is tied around it like a winner’s sash. In front of the cylinders, a small cream price tag on a string lies flat on the tile with two short grey bars on it, no writing. Behind them, a slim teal ruler stands upright with plain tick marks and no numbers. No roads, no lanes, no bank building, no phone. Mood: you compare by what the supplier receives, and the cost is on the tag before you choose.

## H3 · Nothing moves until a person taps

**Where:** How it works · 03 “A person approves”

A small isometric checkpoint on a tile. A cream barrier arm across a short teal track has just lifted. Beside it, a waist-high teal pedestal holds a phone lying face-up with a mint fingerprint circle on its screen, and a small stylised person (simple rounded figure, teal top, no facial features) rests one fingertip on it. A small sealed teal crate with one gold coin emblem on its lid rolls on a little cart through the open barrier toward a payout kiosk: a cream booth with a teal awning and no sign. On the near side of the barrier, a small friendly rounded teal robot stands back holding a clipboard, waiting; it does not touch the phone. Mood: the person decides, the partner delivers, the assistant only prepares.

## H4 · Kept, checkable, tamper-evident

**Where:** How it works · 04 “Proof saved”

An isometric cream filing drawer pulled half open on a tile; one receipt card is sliding down into it between plain folder dividers. On the drawer front, a round teal seal with a bold check mark. To the right, a small browser window (a flat rounded rectangle with three dots in its top bar) floats just above the tile and shows one large mint check circle. In front of it, a second, smaller receipt card lies on the tile with one corner folded over and a small coral cross mark on it: the edited copy that fails. At the back of the drawer, three tiny dark-teal blocks sit stacked like a ledger. No magnifying glass, no chain, no coins. Mood: the record is filed and anyone can check it.

## M · The payment card, with real numbers (rewritten 18 Oct 06:15)

**Where:** Closing band "Move money better". **Sky (CONFIRMED, 06:15):** this is the one image allowed to carry text, flags and amounts.

SELF-CONTAINED: do not paste the shared style block for this one (it bans text). Best on Gemini, which renders text more reliably than Grok.

Isometric 3D illustration, clean vector style with soft cel shading, true isometric camera (30°, no perspective distortion). A single tall payment receipt card stands upright on a thin cream isometric tile with a soft contact shadow. Its front face points toward the lower left. Rounded corners (radius about 8% of the width). The card is a thick slab: the edge is about one-tenth of its width, in warm sand #ECE5D8, with a darker sand inner line, and every edge is outlined in thin dark teal #083640. The face is cream #FFFAF4, matte, with no gloss.

All text is printed flat on the card face, following its isometric angle, in a bold geometric sans-serif (like Geist or Inter) in deep teal #0C3E48. The two amounts are extruded: two steps of mint #9FCFC7, then a dark-teal step behind them, like 3D block letters lying on the face. Spell every word and number exactly as written. Top to bottom:
1. A small label: "You send"
2. A large extruded amount: "US$5,012.50"
3. A small Malaysia flag (red and white stripes, blue canton with a yellow crescent and star) as a tiny raised tile, and beside it: "From Malaysia"
4. A thin sand divider line with a small round sand button in the middle holding a teal downward arrow
5. A small label: "Supplier receives"
6. A large extruded amount: "PHP 287,000.00"
7. A small Philippines flag (blue over red, a white triangle with a yellow sun at the hoist) as a tiny raised tile, and beside it: "Philippines"
8. A rounded sand panel holding a round teal badge with a white check mark and the words "Delivered to the bank"
9. A second rounded sand panel holding a round gold #EFC46F coin icon and the words "Fees US$12.50"
10. At the bottom, in small teal letters, a tiny round teal seal with a check mark and the words "Receipt verifies"

Nothing else on the card: no times, no durations, no percentages, no logos, no QR code, no extra numbers. Next to the base of the card, two gold coins lie flat on the tile, and one thin mint ribbon curls around the bottom-left corner of the card. Palette only: deep teal #0C3E48, teal #0D6370, mint #9FCFC7, cream #FFFAF4, warm sand #ECE5D8, gold #EFC46F. Light from the top-left. Transparent background (or flat cream #FFFAF4 if transparency is not available). Composition 1600 × 1200, the card taking about 60% of the height, with breathing room on all sides.

NEGATIVE: misspelled words, wrong numbers, extra digits, garbled letters, random text, delivery time, minutes, seconds, percentage, fire icon, logo, watermark, QR code, photorealistic, glossy, neon, purple, blue gradient, perspective camera, fisheye, lens flare, dark background, clutter, people

CHECK BEFORE YOU USE IT: read every digit against this list: US$5,012.50, PHP 287,000.00, US$12.50. If any character is wrong, fix it in Canva by covering it with a sand rectangle and retyping in Geist Bold, then skew the text -30° to match the face, rather than regenerating 20 times.

## Round 3 (18 Oct, 06:30): H2, H3, H4 and M received

All four are cut out, trimmed, and placed in preview v5.

| ID | File | Goes to | Verdict |
|---|---|---|---|
| H2 | `H2-ranked-by-what-arrives.png` | How it works 02 | Use. |
| H3 | `H3-person-approves-checkpoint.png` | How it works 03 | Use. Minor: the fingerprints glow neon, which the style bans, and the barrier arm is down, not lifted. Optional regenerate. |
| H4 | `H4-proof-saved.png` | How it works 04 | Use. |
| M | `M-payment-card-cream.png` | Closing band "Move money better" | **Chosen**: the cream card stands out on the cyan band, while the dark card (`M-payment-card-dark.png`) blends into it. **Text error on both: "U$$5,012.50"; the S came out as a $.** Fix before shipping (Gemini edit prompt below). All other text is correct: PHP 287,000.00, Fees US$12.50, Delivered to the bank, Receipt verifies. |

**Gemini edit prompt for M:** upload `M-payment-card-cream.png` and say: "Edit this image. In the large amount at the top, the text reads 'U$$5,012.50'. Change only the second character, the first dollar sign after the U, into a capital letter S, in exactly the same extruded mint 3D style, size and angle, so it reads 'US$5,012.50'. Change nothing else in the image." If it fails twice, regenerate prompt M with the amount written as "USD 5,012.50". That also matches the "PHP 287,000.00" format.

The coded card (`MoneyCard` in the preview source) stays as the reference for any surface where the numbers must be live, such as the dashboard or other corridors.

**06:35 update:** Sky sent the fixed M. The amount now reads "US$5,012.50" (checked at 4× zoom), and all other text is unchanged and correct. `M-payment-card-cream.png` is replaced and live in preview v6. The dark card still has the U$$ error; don't use it.

## Round 4 (18 Oct, 07:15): final preview

- **E2 v3 (CONFIRMED, Sky):** hand on the fingerprint, no button, 8 check tiles, open padlock. It replaces E2 v2 in hero beat 02, and the 8-rules mismatch is now closed. File: `E2-person-approves_v3.png`.
- **SEA region map:** placed in a new landing band before Comparison, "Built for the trade between our neighbours". Corridor list: MY → PH "Sandbox today"; MY → ID / TH / VN / SG "Roadmap". File: `SEA-region-map.png`.
- **Held, not placed (claims or style):**
  - "8 Live Corridors" card: false claim. Only MY → PH exists, and only in sandbox. It also has a photoreal metal style and an engraved "SPLASH FINANCE" wordmark.
  - "Payment Intent · Atomic settlement on Sui, 3.5M USD / 2.4M USDC": wrong chain for the Solana build, and the volume figures are made up.
  - USDC / USDT / USDSui coins: third-party logos, USDSui is Sui-only, and USDT isn't a supported rail.
  - Glass "0" with a USDC coin: glossy photoreal style (banned), Circle's logo, and a "zero" that reads as a zero-fee claim.
  - Second M card render: duplicate. The current cream card stays.
