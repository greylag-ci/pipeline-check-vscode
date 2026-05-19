import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live next to the code they cover (`src/foo.ts` →
    // `src/foo.test.ts`); the .vscodeignore strips `src/**` from the
    // .vsix so tests never ship.
    include: ["src/**/*.test.ts"],
    // Pure-logic suite — no jsdom needed, and the `vscode` module is
    // mocked per-file with vi.mock when a test exercises code that
    // pulls it in.
    environment: "node",
  },
});
