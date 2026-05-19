import { describe, it, expect, vi } from "vitest";

// statusBar.ts imports `vscode` for the runtime wiring; the pure
// helpers (formatStatusBarText, formatStatusBarTooltip,
// countDiagnostics) don't touch it but the module-level import has to
// resolve. Tiny stub covers it.
vi.mock("vscode", () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: {},
  languages: {},
}));

import {
  countDiagnostics,
  formatStatusBarText,
  formatStatusBarTooltip,
} from "./statusBar";

// Helpers
const make = (sev?: string) => ({
  source: "pipeline-check",
  message: "x",
  range: {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  },
  severity: 0,
  data: sev ? { severity: sev } : undefined,
});

describe("formatStatusBarText", () => {
  it("returns 'clean' when there are no findings", () => {
    expect(
      formatStatusBarText({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }),
    ).toBe("$(shield) clean");
  });

  it("leads with critical count when present", () => {
    expect(
      formatStatusBarText({ CRITICAL: 3, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }),
    ).toBe("$(shield) 3C");
  });

  it("pairs critical with high when both present", () => {
    expect(
      formatStatusBarText({ CRITICAL: 3, HIGH: 1, MEDIUM: 9, LOW: 0, INFO: 0 }),
    ).toBe("$(shield) 3C 1H");
  });

  it("shows high alone when no critical", () => {
    expect(
      formatStatusBarText({ CRITICAL: 0, HIGH: 4, MEDIUM: 0, LOW: 0, INFO: 0 }),
    ).toBe("$(shield) 4H");
  });

  it("pairs high with medium when no critical", () => {
    expect(
      formatStatusBarText({ CRITICAL: 0, HIGH: 4, MEDIUM: 2, LOW: 9, INFO: 9 }),
    ).toBe("$(shield) 4H 2M");
  });

  it("collapses to a total when only medium/low/info present", () => {
    expect(
      formatStatusBarText({ CRITICAL: 0, HIGH: 0, MEDIUM: 2, LOW: 3, INFO: 1 }),
    ).toBe("$(shield) 6");
  });
});

describe("formatStatusBarTooltip", () => {
  it("reports 'no findings' on a clean workspace", () => {
    expect(
      formatStatusBarTooltip({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }),
    ).toBe("Pipeline-Check: no findings");
  });

  it("breaks down every nonzero bucket", () => {
    const tip = formatStatusBarTooltip({
      CRITICAL: 1,
      HIGH: 2,
      MEDIUM: 0,
      LOW: 3,
      INFO: 0,
    });
    expect(tip).toContain("Pipeline-Check: 6 findings");
    expect(tip).toContain("CRITICAL: 1");
    expect(tip).toContain("HIGH: 2");
    expect(tip).toContain("LOW: 3");
    expect(tip).not.toContain("MEDIUM");
    expect(tip).not.toContain("INFO");
    expect(tip).toContain("Click to open the Findings panel.");
  });

  it("singular form for one finding", () => {
    expect(
      formatStatusBarTooltip({ CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0 }),
    ).toContain("1 finding");
  });
});

describe("countDiagnostics", () => {
  it("ignores diagnostics whose source is not pipeline-check", () => {
    const iter: Array<[unknown, unknown[]]> = [
      ["uri", [{ ...make("HIGH"), source: "eslint" }]],
    ];
    expect(
      countDiagnostics(
        iter as unknown as Iterable<readonly [unknown, readonly never[]]>,
      ),
    ).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 });
  });

  it("tallies pipeline-check diagnostics by severity", () => {
    const iter: Array<[unknown, unknown[]]> = [
      ["a", [make("CRITICAL"), make("HIGH"), make("HIGH")]],
      ["b", [make("LOW")]],
    ];
    expect(
      countDiagnostics(
        iter as unknown as Iterable<readonly [unknown, readonly never[]]>,
      ),
    ).toEqual({ CRITICAL: 1, HIGH: 2, MEDIUM: 0, LOW: 1, INFO: 0 });
  });

  it("falls back to INFO for missing/unknown severity", () => {
    const iter: Array<[unknown, unknown[]]> = [
      ["a", [make(), make("BOGUS")]],
    ];
    expect(
      countDiagnostics(
        iter as unknown as Iterable<readonly [unknown, readonly never[]]>,
      ),
    ).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 2 });
  });

  it("normalises lowercase severity names", () => {
    const iter: Array<[unknown, unknown[]]> = [
      ["a", [make("high"), make("critical")]],
    ];
    expect(
      countDiagnostics(
        iter as unknown as Iterable<readonly [unknown, readonly never[]]>,
      ),
    ).toEqual({ CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0 });
  });
});
