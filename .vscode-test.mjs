// Configuration for `@vscode/test-cli`, which boots a real VS Code
// extension host so we can verify the contracts that unit tests can
// only approximate: that activation actually fires, commands really
// register, the view appears in the activity bar. The compiled tests
// live in `out-test/` (separate from the esbuild bundle in `dist/`)
// and use mocha-bdd-ui — same convention every official VS Code
// extension uses.

import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  // Compiled test files; `tsconfig.integration.json` emits them.
  files: "out-test/test/integration/**/*.test.js",
  // Open the deliberately-vulnerable sample workflow as the workspace
  // root so activation events fire (workspaceContains:**/.github/workflows/*).
  workspaceFolder: "test-fixtures/sample-workflow",
  // Tests need the extension's commands and views registered before
  // they run; without a sane timeout, mocha may fail before the
  // extension finishes activating in slow CI environments.
  mocha: {
    ui: "bdd",
    timeout: 20000,
    color: true,
  },
});
