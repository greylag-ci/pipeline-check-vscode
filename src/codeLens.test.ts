import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", async () => {
  const { vscodeStub } = await import("./__testStubs__/vscode");
  return vscodeStub();
});

import {
  FindingsCodeLensProvider,
  composeLensTitle,
  summariseCounts,
} from "./codeLens";

const diag = (severity?: string, source = "pipeline-check") =>
  ({
    source,
    message: "",
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
    severity: 0,
    data: severity ? { severity } : undefined,
  }) as unknown as import("vscode").Diagnostic;

describe("summariseCounts", () => {
  it("ignores diagnostics whose source is not pipeline-check", () => {
    expect(summariseCounts([diag("HIGH", "eslint")])).toEqual({
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    });
  });

  it("tallies pipeline-check diagnostics by severity", () => {
    expect(
      summariseCounts([
        diag("CRITICAL"),
        diag("HIGH"),
        diag("HIGH"),
        diag("LOW"),
      ]),
    ).toEqual({ CRITICAL: 1, HIGH: 2, MEDIUM: 0, LOW: 1, INFO: 0 });
  });

  it("falls back to INFO for missing/unknown severity", () => {
    expect(summariseCounts([diag(), diag("BOGUS")])).toEqual({
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 2,
    });
  });

  it("normalises lowercase severity", () => {
    expect(summariseCounts([diag("high")])).toEqual({
      CRITICAL: 0,
      HIGH: 1,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    });
  });
});

describe("composeLensTitle", () => {
  it("returns null on an empty tally so the lens is omitted", () => {
    expect(
      composeLensTitle({
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
        INFO: 0,
      }),
    ).toBeNull();
  });

  it("lists only nonzero buckets, in severity order", () => {
    expect(
      composeLensTitle({
        CRITICAL: 2,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 3,
        INFO: 0,
      }),
    ).toBe("Pipeline-Check: 2 critical · 3 low");
  });

  it("renders a single-bucket tally without separators", () => {
    expect(
      composeLensTitle({
        CRITICAL: 0,
        HIGH: 4,
        MEDIUM: 0,
        LOW: 0,
        INFO: 0,
      }),
    ).toBe("Pipeline-Check: 4 high");
  });

  it("lowercases the severity name in the title", () => {
    const t = composeLensTitle({
      CRITICAL: 1,
      HIGH: 1,
      MEDIUM: 1,
      LOW: 1,
      INFO: 1,
    });
    expect(t).toBe(
      "Pipeline-Check: 1 critical · 1 high · 1 medium · 1 low · 1 info",
    );
  });
});

describe("FindingsCodeLensProvider — pipelineCheck.codeLens.enabled toggle", () => {
  // The provider reads `pipelineCheck.codeLens.enabled` on every
  // `provideCodeLenses` call so a settings flip takes effect on the
  // next render — no extension restart, no editor reopen. These
  // tests pin that behaviour with the shared vscode stub's
  // `getConfiguration` reading from `globalThis.__stubConfig`.

  const ctx = {
    subscriptions: [] as Array<{ dispose: () => void }>,
  } as unknown as import("vscode").ExtensionContext;

  const document = {
    uri: {
      toString: () => "file:///a.yml",
      fsPath: "/a.yml",
      path: "/a.yml",
    },
  } as unknown as import("vscode").TextDocument;

  beforeEach(() => {
    (globalThis as { __stubDiagnostics?: unknown }).__stubDiagnostics = [
      [
        { toString: () => "file:///a.yml" },
        [
          {
            source: "pipeline-check",
            message: "",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            severity: 0,
            data: { severity: "CRITICAL" },
          },
        ],
      ],
    ];
    (globalThis as { __stubConfig?: Record<string, unknown> }).__stubConfig = {};
  });

  it("emits a lens when codeLens.enabled is true (default)", () => {
    const p = new FindingsCodeLensProvider(ctx);
    const lenses = p.provideCodeLenses(document) as unknown[];
    expect(lenses).toHaveLength(1);
  });

  it("emits no lens when codeLens.enabled is false", () => {
    (globalThis as { __stubConfig?: Record<string, unknown> }).__stubConfig = {
      "pipelineCheck.codeLens.enabled": false,
    };
    const p = new FindingsCodeLensProvider(ctx);
    expect(p.provideCodeLenses(document)).toEqual([]);
  });

  it("emits no lens when there are no pipeline-check diagnostics, even if enabled", () => {
    (globalThis as { __stubDiagnostics?: unknown }).__stubDiagnostics = [];
    const p = new FindingsCodeLensProvider(ctx);
    expect(p.provideCodeLenses(document)).toEqual([]);
  });

  it("anchors the lens at line 0 column 0 (top of file)", () => {
    // The lens sits *above* line 1 so it doesn't push the first
    // line of YAML out of view. A future refactor that moves it to
    // the first finding's line would change UX without anyone
    // noticing; lock it down.
    const p = new FindingsCodeLensProvider(ctx);
    const lenses = p.provideCodeLenses(document) as unknown[];
    expect(lenses).toHaveLength(1);
    const lens = lenses[0] as { range: { start: { line: number; character: number } } };
    expect(lens.range.start.line).toBe(0);
    expect(lens.range.start.character).toBe(0);
  });

  it("targets the pipelineCheck.findings.focus command so click reveals the panel", () => {
    // Other plausible click targets (vscode.open, the file at the
    // finding location, the rule docs URL) all do different things.
    // The lens is meant as a *drill-in* — surface the panel grouped
    // by severity so the user can scan the per-file count in context.
    const p = new FindingsCodeLensProvider(ctx);
    const lenses = p.provideCodeLenses(document) as unknown[];
    const lens = lenses[0] as {
      command?: { command: string; title: string };
    };
    expect(lens.command?.command).toBe("pipelineCheck.findings.focus");
  });

  it("renders the title from the live count, not the constructor snapshot", () => {
    // Without rebuilding the provider, the lens text must reflect
    // whatever the diagnostic store says right now. (The provider
    // calls summariseCounts inside provideCodeLenses each time, but
    // the test exists to catch a future "cache once at construction"
    // refactor.)
    const p = new FindingsCodeLensProvider(ctx);
    const lenses1 = p.provideCodeLenses(document) as unknown[];
    const title1 = (lenses1[0] as { command?: { title: string } }).command
      ?.title;
    expect(title1).toContain("1 critical");

    // Now swap the stub diagnostics underneath the provider and
    // request fresh lenses.
    (globalThis as { __stubDiagnostics?: unknown }).__stubDiagnostics = [
      [
        { toString: () => "file:///a.yml" },
        [
          {
            source: "pipeline-check",
            message: "",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            severity: 0,
            data: { severity: "HIGH" },
          },
          {
            source: "pipeline-check",
            message: "",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            severity: 0,
            data: { severity: "HIGH" },
          },
        ],
      ],
    ];
    const lenses2 = p.provideCodeLenses(document) as unknown[];
    const title2 = (lenses2[0] as { command?: { title: string } }).command
      ?.title;
    expect(title2).toContain("2 high");
    expect(title2).not.toContain("critical");
  });

  it("only considers the document's OWN diagnostics, not the workspace total", () => {
    // The lens is per-file; the Findings panel is the workspace
    // aggregate. Confusing the two would show "10 critical" on a
    // file with zero findings just because the workspace has them.
    (globalThis as { __stubDiagnostics?: unknown }).__stubDiagnostics = [
      [
        { toString: () => "file:///OTHER.yml" },
        [
          {
            source: "pipeline-check",
            message: "",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            severity: 0,
            data: { severity: "CRITICAL" },
          },
        ],
      ],
    ];
    const p = new FindingsCodeLensProvider(ctx);
    // The stub's getDiagnostics(uri) returns diagnostics keyed by
    // `uri.toString()`; our document is "file:///a.yml", which is
    // not in the stubbed store. Should yield no lenses.
    expect(p.provideCodeLenses(document)).toEqual([]);
  });
});
