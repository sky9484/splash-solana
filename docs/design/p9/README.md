# Prompt 11: the float, Transfer and Treasury (v15.1, 14 Oct 2026)

Prompt 11 is built as one pull request per phase, each into `sol/b0-p9-base`. `sol/b0-p9-base`
started at `b41dc50`, the head of `sol/b0-p8-7-check` (prompt 10's independent check). The whole of
prompt 11 then goes from `sol/b0-p9-base` into `sol/b0-p8-7-check`. That branch is still open in
[sky9484/splash-solana#24](https://github.com/sky9484/splash-solana/pull/24), into `sol/b0-p8-design`.

## The phase PRs (merge in this order, with merge commits)

Each phase branch starts from the one before it. A phase's diff shows the earlier phases until they
merge.

| PR | Phase | Branch |
|---|---|---|
| [#26](https://github.com/sky9484/splash-solana/pull/26) | 0 · before pictures and `COMPARE.md` | `sol/b0-p9-0-before` |
| [#27](https://github.com/sky9484/splash-solana/pull/27) | 1 · warm paper, floating boxes, 40/48 px buttons, dropdown portal | `sol/b0-p9-1-surfaces` |
| [#28](https://github.com/sky9484/splash-solana/pull/28) | 2 · Transfer in five steps under a dark intent header | `sol/b0-p9-2-transfer` |
| [#29](https://github.com/sky9484/splash-solana/pull/29) | 3 · Invoices chooser motion, checked in Chrome | `sol/b0-p9-3-invoices` |
| [#30](https://github.com/sky9484/splash-solana/pull/30) | 4 · Smart Treasury | `sol/b0-p9-4-treasury` |
| [#31](https://github.com/sky9484/splash-solana/pull/31) | 5 · the independent check, re-shoot and motion audit | `sol/b0-p9-5-check` |

## Where to look
- **Before and after:** `docs/design/p9/COMPARE.md`. It is started in Phase 0, and Phase 5 adds every
  screen side by side at 1440 px and 390 px.
- **Evidence per phase:** `docs/design/p9/evidence/` (screenshots, GIFs, the surfaces checks).
- **What isn't verified:** the README's "Not verified yet" list (updated in Phase 5).

## Sky's two instructions, kept in every phase
- The nav and the header are unchanged.
- The floating Zeke is unchanged. Its only touch is rising above the pinned bottom bar on phones.
