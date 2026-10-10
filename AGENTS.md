<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Required skills — load BEFORE starting any task

These skills are **mandatory** for this project. Invoke the relevant ones at the
start of a task even when the request does not name them — the human often
forgets to mention them, and "no skill named" is not a reason to skip. Use the
Skill tool (or `/<name>`). If a listed skill is unavailable in the session, say
so explicitly rather than silently proceeding without it.

**Always, for any UI / visual / frontend work (which is most work here):**
- `ui-ux-pro-max` — layout, color, typography, accessibility, component design.
- `isometric-typography-designer` — the Splash isometric visual language (hero
  art, diagrams, depth/lighting, display type). Keep the brand look consistent.
- `frontend-design` — distinctive, non-templated visual direction.
- `design-taste-frontend` (taste-skill) — anti-slop guardrails so nothing ships
  looking generic/templated. Installed in `.agents/skills/` and user-level.

**For Sui Move / smart-contract work:**
- `sui-move` and `sui-move-project` — official Mysten guidance (abilities,
  upgrades, Move.toml/Published.toml, dependency/build errors).
- `sui-security-auditor` (+ OpenZeppelin math) — every contract change. See the
  existing Sui Move workflow below and `SECURITY.md`.

**For agent / finance / product logic (0xWal, treasury, payments, compliance):**
- `agentic-finance-expert`, `payments-treasury-expert`, `fintech-architect`,
  `ai-agent-systems-architect` — apply the ones matching the change.

**When unsure what exists:** run `find-skills` (`npx skills find <query>`) before
concluding a capability is missing.

Design/typography deliverables must run through the design skills above, not be
hand-rolled. This policy is a floor, not a ceiling — pull in any other relevant
skill too.

## Sui Move workflow

- Read the current Sui and dependency documentation before changing Move code.
- Use the repository-local Sui Pilot checkout installed by `npm run setup:sui-pilot`
  as an advisory documentation and review source.
- For contract changes, apply the Sui Pilot quality, security, OpenZeppelin math,
  and specification guidance represented by `/move-code-quality`,
  `/move-code-review`, `/oz-math`, and `/specify`.
- Sui Pilot output does not replace local verification. Run `sui move build` and
  `sui move test` with a Sui CLI compatible with the pinned dependencies.
