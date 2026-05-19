import { describe, it, expect, vi } from "vitest";

// statusBar.ts imports `vscode` for the runtime wiring; the pure
// helpers (formatStatusBarText, formatStatusBarTooltip,
// countDiagnostics, pickBackgroundColor) don't touch it but the
// module-level import has to resolve. Tiny stub covers it; ThemeColor
// is a class so `new vscode.ThemeColor(id)` works and tests can read
// `.id` off the result.
vi.mock("vscode", () => {
  class ThemeColor {
    constructor(public readonly id: string) {}
  }
  return {
    ThemeColor,
    StatusBarAlignment: { Left: 1, Right: 2 },
    window: {},
    languages: {},
  };
});

import {
  countDiagnostics,
  formatStatusBarAccessibilityLabel,
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

describe("formatStatusBarAccessibilityLabel", () => {
  it("returns a clean message when there are no findings", () => {
    expect(
      formatStatusBarAccessibilityLabel({
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
        INFO: 0,
      }),
    ).toBe("Pipeline-Check: no findings");
  });

  it("spells out the per-severity tally with full words", () => {
    expect(
      formatStatusBarAccessibilityLabel({
        CRITICAL: 3,
        HIGH: 1,
        MEDIUM: 0,
        LOW: 0,
        INFO: 0,
      }),
    ).toBe("Pipeline-Check: 3 critical, 1 high");
  });

  it("omits zero buckets so the label stays scannable", () => {
    expect(
      formatStatusBarAccessibilityLabel({
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 5,
        INFO: 0,
      }),
    ).toBe("Pipeline-Check: 5 low");
  });

  it("contains no codicon shortcodes (screen readers can't read $(shield))", () => {
    const label = formatStatusBarAccessibilityLabel({
      CRITICAL: 1,
      HIGH: 1,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    });
    expect(label).not.toMatch(/\$\(/);
  });
});

describe("formatStatusBarTooltip", () => {
  it("teaches the Alt+F8 keyboard shortcut on the trailing line", () => {
    const tip = formatStatusBarTooltip({
      CRITICAL: 1,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    });
    expect(tip).toContain("Alt+F8");
    expect(tip).toContain("Shift+Alt+F8");
  });

  it("does not include the keyboard hint when there are no findings", () => {
    const tip = formatStatusBarTooltip({
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    });
    expect(tip).not.toContain("Alt+F8");
  });
});

describe("pickBackgroundColor", () => {
  // The stub vscode module returns `{ id }` as the ThemeColor — the
  // tests check the colour by id rather than relying on identity.
  // We need ThemeColor to be available in the stub for this test;
  // statusBar.test.ts's existing minimal stub doesn't include it.
  // Below we re-import the function through the same minimal stub
  // (vi.mock at the top of this file maps `vscode` to the inline
  // object), so we read .id off whatever shape it returns.

  // Pull the function lazily so the vi.mock at the top is already in
  // place when it resolves.
  async function pick(c: import("./statusBar").SeverityCounts) {
    const mod = await import("./statusBar");
    return mod.pickBackgroundColor(c);
  }

  it("returns the error-background token when CRITICAL is present", async () => {
    const bg = (await pick({
      CRITICAL: 1,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    })) as { id: string } | undefined;
    expect(bg?.id).toBe("statusBarItem.errorBackground");
  });

  it("CRITICAL outranks HIGH for the colour choice", async () => {
    const bg = (await pick({
      CRITICAL: 1,
      HIGH: 5,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    })) as { id: string } | undefined;
    expect(bg?.id).toBe("statusBarItem.errorBackground");
  });

  it("returns the warning-background token when HIGH (but no CRITICAL) is present", async () => {
    const bg = (await pick({
      CRITICAL: 0,
      HIGH: 3,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    })) as { id: string } | undefined;
    expect(bg?.id).toBe("statusBarItem.warningBackground");
  });

  it("returns undefined when only MEDIUM / LOW / INFO are present", async () => {
    expect(
      await pick({
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 4,
        LOW: 9,
        INFO: 2,
      }),
    ).toBeUndefined();
  });

  it("returns undefined on a clean workspace", async () => {
    expect(
      await pick({
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
        INFO: 0,
      }),
    ).toBeUndefined();
  });
});
