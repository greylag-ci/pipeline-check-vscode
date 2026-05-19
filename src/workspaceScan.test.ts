import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", async () => {
  const { vscodeStub } = await import("./__testStubs__/vscode");
  return vscodeStub();
});

import { formatSummary } from "./workspaceScan";

// Pure-logic surface of workspaceScan.ts. The async scan itself is
// hard to unit-test without the VS Code host (findFiles + progress +
// openTextDocument). Integration coverage of the file-discovery path
// lives in src/test/integration/activation.test.ts.

describe("formatSummary", () => {
  it("clean run: 'scanned N files'", () => {
    expect(formatSummary({ scanned: 5, failed: 0, cancelled: false })).toBe(
      "Pipeline-Check: scanned 5 files.",
    );
  });

  it("singular form for one file", () => {
    expect(formatSummary({ scanned: 1, failed: 0, cancelled: false })).toBe(
      "Pipeline-Check: scanned 1 file.",
    );
  });

  it("reports failures separately from scans", () => {
    expect(formatSummary({ scanned: 4, failed: 1, cancelled: false })).toBe(
      "Pipeline-Check: scanned 4 files (1 failed).",
    );
  });

  it("cancelled run carries the partial count", () => {
    expect(formatSummary({ scanned: 3, failed: 0, cancelled: true })).toBe(
      "Pipeline-Check: scan cancelled after 3 files (0 failed).",
    );
  });

  it("zero-scan clean run still reads naturally", () => {
    expect(formatSummary({ scanned: 0, failed: 0, cancelled: false })).toBe(
      "Pipeline-Check: scanned 0 files.",
    );
  });
});
