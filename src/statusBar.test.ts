import { describe, it, expect, vi, beforeEach } from "vitest";

// Use the shared stub so the registerStatusBar tests below have a
// real-shaped `vscode.window.createStatusBarItem`, `workspace.findFiles`,
// and `languages.onDidChangeDiagnostics`. The pure-helper tests don't
// need any of that, but a single mock keeps the file consistent.
vi.mock("vscode", async () => {
  const { vscodeStub } = await import("./__testStubs__/vscode");
  return vscodeStub();
});

import { resetStubState } from "./__testStubs__/vscode";
import {
  _getEngineVersionForTesting,
  _workspaceHasCiGlobForTesting,
  countDiagnostics,
  formatStatusBarAccessibilityLabel,
  formatStatusBarText,
  formatStatusBarTooltip,
  pickBackgroundColor,
  registerStatusBar,
  setEngineVersion,
} from "./statusBar";
import { TRIGGER_PATTERNS } from "./providers";

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

// URI factory shaped like `vscode.Uri` for the stub's purposes.
const uri = (path: string) => ({
  toString: () => `file://${path}`,
  fsPath: path,
});

beforeEach(() => {
  resetStubState();
  // Reset the module-level engine-version slot so a test that sets it
  // doesn't leak into the next case's tooltip assertions.
  setEngineVersion(undefined);
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

  it("appends 'Engine vX.Y.Z' when a version is supplied", () => {
    const tip = formatStatusBarTooltip(
      { CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
      "1.2.3",
    );
    expect(tip).toContain("Engine v1.2.3");
    // Engine line is the LAST line so the keyboard-shortcut hint
    // sits visually above it (more important to most users).
    const lines = tip.split("\n");
    expect(lines[lines.length - 1]).toBe("Engine v1.2.3");
  });

  it("omits the engine line when no version is supplied", () => {
    const tip = formatStatusBarTooltip({
      CRITICAL: 1,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    });
    expect(tip).not.toContain("Engine v");
  });

  it("includes the engine line on a clean workspace too", () => {
    // The "no findings" branch took an early-return before; pin the
    // post-refactor behaviour that still appends the engine line so
    // the version is visible without waiting for a finding to land.
    const tip = formatStatusBarTooltip(
      { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
      "1.2.3",
    );
    expect(tip).toContain("Pipeline-Check: no findings");
    expect(tip).toContain("Engine v1.2.3");
    // No Alt+F8 hint on a clean tooltip — there's nothing to step
    // through, the hint would only confuse.
    expect(tip).not.toContain("Alt+F8");
  });
});

describe("setEngineVersion", () => {
  it("stores the latest value and serves it back", () => {
    setEngineVersion("1.2.3");
    expect(_getEngineVersionForTesting()).toBe("1.2.3");
    setEngineVersion("1.2.4");
    expect(_getEngineVersionForTesting()).toBe("1.2.4");
  });

  it("clears with undefined (used on stopClient)", () => {
    setEngineVersion("1.2.3");
    setEngineVersion(undefined);
    expect(_getEngineVersionForTesting()).toBeUndefined();
  });

  it("survives being called before registerStatusBar (no rerender wired yet)", () => {
    // Tests run in any order; setEngineVersion must not throw if the
    // module hasn't been wired yet. The value is captured and shows
    // up the next time registerStatusBar paints.
    expect(() => setEngineVersion("0.5.0")).not.toThrow();
    expect(_getEngineVersionForTesting()).toBe("0.5.0");
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

describe("pickBackgroundColor", () => {
  it("returns the error-background token when CRITICAL is present", () => {
    const bg = pickBackgroundColor({
      CRITICAL: 1,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    }) as { id: string } | undefined;
    expect(bg?.id).toBe("statusBarItem.errorBackground");
  });

  it("CRITICAL outranks HIGH for the colour choice", () => {
    const bg = pickBackgroundColor({
      CRITICAL: 1,
      HIGH: 5,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    }) as { id: string } | undefined;
    expect(bg?.id).toBe("statusBarItem.errorBackground");
  });

  it("returns the warning-background token when HIGH (but no CRITICAL) is present", () => {
    const bg = pickBackgroundColor({
      CRITICAL: 0,
      HIGH: 3,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    }) as { id: string } | undefined;
    expect(bg?.id).toBe("statusBarItem.warningBackground");
  });

  it("returns undefined when only MEDIUM / LOW / INFO are present", () => {
    expect(
      pickBackgroundColor({
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 4,
        LOW: 9,
        INFO: 2,
      }),
    ).toBeUndefined();
  });

  it("returns undefined on a clean workspace", () => {
    expect(
      pickBackgroundColor({
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
        INFO: 0,
      }),
    ).toBeUndefined();
  });
});

describe("registerStatusBar — visibility latch", () => {
  // The latch keeps the item hidden until the workspace looks
  // CI-relevant (at least one matching file OR at least one published
  // diagnostic). Once "seen" as relevant, the item stays visible even
  // through clean (zero) publishes — the "clean" signal earns its
  // keep. These tests pin both halves of that policy.

  const ctx = {
    subscriptions: [] as Array<{ dispose?: () => void }>,
  } as unknown as import("vscode").ExtensionContext;

  // Helper: read the most recently created stub status bar item.
  function lastItem() {
    const items = globalThis.__stubCalls?.statusBarItems ?? [];
    return items[items.length - 1];
  }

  // Helper: yield to the microtask queue so the deferred findFiles
  // promise inside registerStatusBar settles before we assert.
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  it("starts hidden when the workspace has neither CI files nor diagnostics", async () => {
    globalThis.__stubFindFiles = [];
    globalThis.__stubDiagnostics = [];
    registerStatusBar(ctx);
    await tick();
    expect(lastItem().shown).toBe(false);
  });

  it("shows itself once findFiles reports at least one CI candidate", async () => {
    globalThis.__stubFindFiles = [uri("/repo/.github/workflows/ci.yml")];
    globalThis.__stubDiagnostics = [];
    registerStatusBar(ctx);
    await tick();
    expect(lastItem().shown).toBe(true);
  });

  it("shows itself when at least one pipeline-check diagnostic is already published", async () => {
    // Workspace has no candidate file (e.g. an untitled buffer that
    // somehow carries findings); a published diagnostic still
    // qualifies us as relevant.
    globalThis.__stubFindFiles = [];
    globalThis.__stubDiagnostics = [[uri("/r/a.yml"), [make("HIGH")]]];
    registerStatusBar(ctx);
    await tick();
    expect(lastItem().shown).toBe(true);
  });

  it("ignores non-pipeline-check diagnostics for the latch (eslint shouldn't show us)", async () => {
    globalThis.__stubFindFiles = [];
    globalThis.__stubDiagnostics = [
      [
        uri("/r/a.yml"),
        [{ ...make("HIGH"), source: "eslint" }],
      ],
    ];
    registerStatusBar(ctx);
    await tick();
    expect(lastItem().shown).toBe(false);
  });

  it("paints text/tooltip/accessibility/background colour from the initial counts", async () => {
    globalThis.__stubFindFiles = [uri("/repo/Dockerfile")];
    globalThis.__stubDiagnostics = [
      [uri("/r/a.yml"), [make("CRITICAL"), make("HIGH")]],
    ];
    registerStatusBar(ctx);
    await tick();
    const item = lastItem();
    expect(item.text).toContain("$(shield)");
    expect(item.text).toContain("1C");
    expect(item.text).toContain("1H");
    expect((item.tooltip as string).toLowerCase()).toContain("pipeline-check");
    expect(item.accessibilityInformation?.label).toContain("1 critical");
    expect((item.backgroundColor as { id: string })?.id).toBe(
      "statusBarItem.errorBackground",
    );
  });

  it("wires the click target to the Findings panel focus command", async () => {
    globalThis.__stubFindFiles = [];
    globalThis.__stubDiagnostics = [];
    registerStatusBar(ctx);
    await tick();
    expect(lastItem().command).toBe("pipelineCheck.findings.focus");
  });

  it("uses the documented 'Pipeline-Check' menu name", async () => {
    globalThis.__stubFindFiles = [];
    globalThis.__stubDiagnostics = [];
    registerStatusBar(ctx);
    await tick();
    expect(lastItem().name).toBe("Pipeline-Check");
  });

  it("pushes the status bar item onto context.subscriptions for cleanup", async () => {
    globalThis.__stubFindFiles = [];
    globalThis.__stubDiagnostics = [];
    const subs: Array<{ dispose?: () => void }> = [];
    const localCtx = {
      subscriptions: subs,
    } as unknown as import("vscode").ExtensionContext;
    registerStatusBar(localCtx);
    await tick();
    // The returned item itself + the onDidChangeDiagnostics disposable
    // + the onDidChangeWorkspaceFolders disposable all land here.
    expect(subs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("registerStatusBar — latch release on folder removal", () => {
  // The latch needs to BOTH set and unset based on workspace
  // relevance. The old behaviour latched once and never released —
  // removing the only CI folder from a multi-root workspace left
  // the item visible with "clean" for the rest of the session.

  const ctx = {
    subscriptions: [] as Array<{ dispose?: () => void }>,
  } as unknown as import("vscode").ExtensionContext;

  function lastItem() {
    const items = globalThis.__stubCalls?.statusBarItems ?? [];
    return items[items.length - 1];
  }

  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  /** Fire the onDidChangeWorkspaceFolders event registered listeners. */
  function fireWorkspaceFoldersChange(): void {
    const listeners = globalThis.__stubWorkspaceFoldersListeners ?? [];
    for (const l of listeners) l({ added: [], removed: [] });
  }

  it("hides the item when the last CI candidate disappears and no diagnostics remain", async () => {
    // Start latched: workspace has a CI file.
    globalThis.__stubFindFiles = [uri("/repo/.github/workflows/ci.yml")];
    globalThis.__stubDiagnostics = [];
    registerStatusBar(ctx);
    await tick();
    expect(lastItem().shown).toBe(true);

    // User removes the only CI folder; sweep now finds nothing.
    globalThis.__stubFindFiles = [];
    fireWorkspaceFoldersChange();
    await tick();
    expect(lastItem().shown).toBe(false);
  });

  it("does NOT release when diagnostics are still present (in-flight rebuild guard)", async () => {
    // A momentary "no candidate files" state during a rebuild
    // shouldn't hide the bar if there are still findings to report.
    globalThis.__stubFindFiles = [uri("/repo/.github/workflows/ci.yml")];
    globalThis.__stubDiagnostics = [
      [uri("/r/a.yml"), [make("CRITICAL")]],
    ];
    registerStatusBar(ctx);
    await tick();
    expect(lastItem().shown).toBe(true);

    globalThis.__stubFindFiles = [];
    fireWorkspaceFoldersChange();
    await tick();
    // Findings still there → still visible.
    expect(lastItem().shown).toBe(true);
  });

  it("re-latches when a CI folder is added back", async () => {
    // Start without CI files.
    globalThis.__stubFindFiles = [];
    globalThis.__stubDiagnostics = [];
    registerStatusBar(ctx);
    await tick();
    expect(lastItem().shown).toBe(false);

    // User adds a folder that contains CI configs.
    globalThis.__stubFindFiles = [uri("/repo/.github/workflows/ci.yml")];
    fireWorkspaceFoldersChange();
    await tick();
    expect(lastItem().shown).toBe(true);
  });

  it("subscribes to onDidChangeWorkspaceFolders exactly once at activation", async () => {
    // A future refactor that adds the listener in `update()` would
    // register a new listener every diagnostic publish; pin the
    // single-subscription contract.
    globalThis.__stubFindFiles = [];
    globalThis.__stubDiagnostics = [];
    registerStatusBar(ctx);
    await tick();
    const listeners = globalThis.__stubWorkspaceFoldersListeners ?? [];
    expect(listeners).toHaveLength(1);
  });
});

// ─── WORKSPACE_HAS_CI_GLOB ↔ TRIGGER_PATTERNS invariant ─────────────

describe("WORKSPACE_HAS_CI_GLOB — derived from TRIGGER_PATTERNS", () => {
  // The status bar's relevance probe (the `findFiles` sweep that
  // decides whether to surface the item at all) reads from a
  // WORKSPACE_HAS_CI_GLOB built from TRIGGER_PATTERNS. Before v1.6.x
  // this constant was a hard-coded string mirror that drifted when
  // providers.ts widened — workspaces whose only CI file was a
  // `.gitlab-ci.yaml`, `Dockerfile.alpine`, etc. wouldn't latch the
  // bar as relevant on activation. Same silent-drift class
  // src/manifest.test.ts now fences for `activationEvents`. This
  // test closes the equivalent gap on the status bar's side.

  it("contains every TRIGGER_PATTERN as a comma-separated alternative inside a single brace group", () => {
    // Build the same shape the runtime derives so a future
    // refactor that switches the join strategy still trips the
    // fence if a pattern is dropped or added.
    const expected = `{${TRIGGER_PATTERNS.join(",")}}`;
    expect(_workspaceHasCiGlobForTesting).toBe(expected);
  });

  it("includes every pattern verbatim (no stripping of brace alternatives)", () => {
    // Defence against a future "let's expand the braces for
    // VS Code findFiles compatibility" change — findFiles does
    // support nested braces, so the runtime should leave them
    // alone. If someone strips them, fire loudly.
    for (const pattern of TRIGGER_PATTERNS) {
      expect(_workspaceHasCiGlobForTesting).toContain(pattern);
    }
  });
});
