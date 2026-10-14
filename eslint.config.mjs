import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // The browser walkthrough's own dev server output (next.config.ts NEXT_DIST_DIR).
    ".next-e2e/**",
    ".tools/**",
    ".tmp/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees are whole checkouts nested in this one, with their own
    // .next build output; they are linted in their own checkout, not here.
    ".claude/**",
    // Installed agent skills (skills-lock.json): third-party instructions and tooling, not app code.
    ".agents/**",
  ]),
  // One module owns Sui (prompt 07 §4.1): the evidence layer, Seal + Walrus.
  // Nothing else may import a Mysten package — settlement is Solana. The
  // dynamic-import case is caught by tests/solana-boundary.test.mjs.
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    ignores: ["lib/evidence-sui/**", "tests/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@mysten/*", "@mysten-incubation/*"],
              message: "Only lib/evidence-sui/** may import @mysten packages (prompt 07 §4.1). Go through the evidence layer.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
