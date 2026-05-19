// ESLint flat-config — replaces the legacy `.eslintrc.json`.
//
// Rules carry over verbatim from the old config so this is purely a
// format migration; the lint result of the suite should be unchanged.
// The flat-config switch unblocks the eslint v8 → v9 bump (flat config
// is the default-and-only format from v9 onward).
//
// Order matters: later configs in the array override earlier ones.
// We stack `eslint:recommended` first, then `typescript-eslint`'s
// recommended preset (parser + plugin + sensible defaults for .ts
// files), then our own per-rule overrides.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  // Global ignores. Equivalent to `ignorePatterns` in the old config
  // plus the v0.2.0 additions (out-test, dist) so the lint walker
  // doesn't recurse into generated output.
  {
    ignores: [
      "out/**",
      "out-test/**",
      "dist/**",
      "node_modules/**",
      ".vscode-test/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
