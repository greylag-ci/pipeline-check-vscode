import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit-test suite. Pure-logic tests live next to the code they
    // cover (`src/foo.ts` → `src/foo.test.ts`); the .vscodeignore
    // strips `src/**` from the .vsix so tests never ship.
    //
    // The integration suite under src/test/integration/ uses mocha
    // (booted by @vscode/test-electron) so vitest must not try to
    // run those files — different test framework, different runner.
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "src/test/integration/**"],
    // Pure-logic suite — no jsdom needed, and the `vscode` module is
    // mocked per-file with vi.mock when a test exercises code that
    // pulls it in.
    environment: "node",
  },
});
