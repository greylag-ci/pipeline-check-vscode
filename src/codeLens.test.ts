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
});
