import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", async () => {
  const { vscodeStub } = await import("./__testStubs__/vscode");
  return vscodeStub();
});

import { resetStubState } from "./__testStubs__/vscode";
import { setLspReady } from "./lspState";
import {
  findScannableFiles,
  formatSummary,
  scanWorkspace,
} from "./workspaceScan";

beforeEach(() => {
  resetStubState();
  // The scan command bails when the LSP is not ready (otherwise it
  // would openTextDocument every file with no didOpen recipient and
  // mislead the user with a "scanned N files" toast). Default tests
  // to the ready state; the not-ready behaviour gets its own block.
  setLspReady(true);
});

// Small URI factory matching the shape findFiles returns and
// scanWorkspace consumes — `toString()` for dedupe, `fsPath` for
// progress messages.
function fakeUri(path: string) {
  return {
    toString: () => `file://${path}`,
    fsPath: path,
  };
}

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

describe("findScannableFiles", () => {
  // This is the regression fence for the nested-brace findFiles bug.
  // The "no scannable files found" symptom returned when a single
  // combined glob with nested braces silently matched nothing.

  it("queries findFiles once per pattern (NOT one nested-brace glob)", async () => {
    // If a future refactor goes back to `{a,b,c}` we get zero matches
    // again. This assertion locks the per-pattern shape.
    globalThis.__stubFindFiles = [];
    await findScannableFiles(
      ["**/.github/workflows/*.{yml,yaml}", "**/.gitlab-ci.yml", "**/Dockerfile"],
      "**/node_modules/**",
    );
    const calls = globalThis.__stubCalls?.findFiles ?? [];
    expect(calls.map((c) => c.include)).toEqual([
      "**/.github/workflows/*.{yml,yaml}",
      "**/.gitlab-ci.yml",
      "**/Dockerfile",
    ]);
  });

  it("passes the exclude glob through verbatim on every call", async () => {
    globalThis.__stubFindFiles = [];
    const exclude = "**/{node_modules,.git}/**";
    await findScannableFiles(["**/a", "**/b"], exclude);
    const calls = globalThis.__stubCalls?.findFiles ?? [];
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.exclude).toBe(exclude);
    }
  });

  it("returns the union of per-pattern matches", async () => {
    globalThis.__stubFindFilesByPattern = {
      "**/.github/workflows/*.{yml,yaml}": [fakeUri("/r/.github/workflows/ci.yml")],
      "**/.gitlab-ci.yml": [fakeUri("/r/.gitlab-ci.yml")],
      "**/Dockerfile": [fakeUri("/r/Dockerfile")],
    };
    const out = await findScannableFiles(
      [
        "**/.github/workflows/*.{yml,yaml}",
        "**/.gitlab-ci.yml",
        "**/Dockerfile",
      ],
      "",
    );
    expect(out.map((u) => u.fsPath).sort()).toEqual([
      "/r/.github/workflows/ci.yml",
      "/r/.gitlab-ci.yml",
      "/r/Dockerfile",
    ]);
  });

  it("dedupes URIs that match more than one pattern", async () => {
    // A Containerfile pattern could plausibly overlap with a future
    // glob; the dedupe contract has to hold or progress reporting
    // double-counts and openTextDocument fires twice on the same file.
    const dup = fakeUri("/r/Dockerfile");
    globalThis.__stubFindFilesByPattern = {
      "**/Dockerfile": [dup],
      "**/Containerfile": [dup],
    };
    const out = await findScannableFiles(
      ["**/Dockerfile", "**/Containerfile"],
      "",
    );
    expect(out).toHaveLength(1);
    expect(out[0].fsPath).toBe("/r/Dockerfile");
  });

  it("preserves first-seen order across deduped patterns", async () => {
    const a = fakeUri("/r/a.yml");
    const b = fakeUri("/r/b.yml");
    const c = fakeUri("/r/c.yml");
    globalThis.__stubFindFilesByPattern = {
      "**/p1": [a, b],
      "**/p2": [b, c], // b overlaps; should NOT move to position after c.
    };
    const out = await findScannableFiles(["**/p1", "**/p2"], "");
    expect(out.map((u) => u.fsPath)).toEqual(["/r/a.yml", "/r/b.yml", "/r/c.yml"]);
  });

  it("returns empty when every pattern misses", async () => {
    globalThis.__stubFindFiles = [];
    const out = await findScannableFiles(["**/.gitlab-ci.yml"], "");
    expect(out).toEqual([]);
  });

  it("handles an empty pattern list (zero findFiles calls, empty result)", async () => {
    const out = await findScannableFiles([], "");
    expect(out).toEqual([]);
    expect(globalThis.__stubCalls?.findFiles).toEqual([]);
  });
});

describe("scanWorkspace — no-workspace path", () => {
  it("returns zero counts and a friendly toast when no folder is open", async () => {
    // workspaceFolders defaults to undefined after resetStubState.
    const result = await scanWorkspace();
    expect(result).toEqual({ scanned: 0, failed: 0, cancelled: false });
    const info = globalThis.__stubCalls?.infoMessages ?? [];
    expect(info).toHaveLength(1);
    expect(info[0]).toContain("open a workspace folder");
  });

  it("quiet mode suppresses the no-workspace toast", async () => {
    const result = await scanWorkspace({ quiet: true });
    expect(result).toEqual({ scanned: 0, failed: 0, cancelled: false });
    expect(globalThis.__stubCalls?.infoMessages ?? []).toEqual([]);
  });
});

describe("scanWorkspace — no-files path", () => {
  beforeEach(() => {
    globalThis.__stubWorkspaceFolders = [
      { uri: { toString: () => "file:///r", fsPath: "/r" } },
    ];
    globalThis.__stubFindFiles = [];
  });

  it("returns zero counts and surfaces 'no scannable files' to the user", async () => {
    const result = await scanWorkspace();
    expect(result).toEqual({ scanned: 0, failed: 0, cancelled: false });
    const info = globalThis.__stubCalls?.infoMessages ?? [];
    expect(info).toHaveLength(1);
    expect(info[0].toLowerCase()).toContain("no scannable files");
  });

  it("quiet mode still scans but emits no toast", async () => {
    const result = await scanWorkspace({ quiet: true });
    expect(result).toEqual({ scanned: 0, failed: 0, cancelled: false });
    expect(globalThis.__stubCalls?.infoMessages ?? []).toEqual([]);
  });
});

describe("scanWorkspace — scanning path", () => {
  beforeEach(() => {
    globalThis.__stubWorkspaceFolders = [
      { uri: { toString: () => "file:///r", fsPath: "/r" } },
    ];
  });

  it("opens every matching file and counts each as scanned", async () => {
    globalThis.__stubFindFiles = [
      fakeUri("/r/.github/workflows/a.yml"),
      fakeUri("/r/.github/workflows/b.yml"),
      fakeUri("/r/Dockerfile"),
    ];
    const result = await scanWorkspace();
    // findScannableFiles fires once per pattern (10 patterns), but
    // since __stubFindFiles is the same for every include, dedupe
    // collapses it back to the three URIs.
    expect(result.scanned).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(false);
  });

  it("emits a success toast in noisy mode", async () => {
    globalThis.__stubFindFiles = [fakeUri("/r/Dockerfile")];
    await scanWorkspace();
    const info = globalThis.__stubCalls?.infoMessages ?? [];
    expect(info.some((m) => m.toLowerCase().includes("scanned"))).toBe(true);
  });

  it("emits no toast in quiet mode even when files were scanned", async () => {
    globalThis.__stubFindFiles = [fakeUri("/r/Dockerfile")];
    await scanWorkspace({ quiet: true });
    expect(globalThis.__stubCalls?.infoMessages ?? []).toEqual([]);
    expect(globalThis.__stubCalls?.warningMessages ?? []).toEqual([]);
  });

  it("counts an openTextDocument rejection as failed without aborting the run", async () => {
    const ok1 = fakeUri("/r/a.yml");
    const bad = fakeUri("/r/bad.yml");
    const ok2 = fakeUri("/r/b.yml");
    globalThis.__stubFindFiles = [ok1, bad, ok2];
    globalThis.__stubOpenTextDocumentFailures = new Set([bad.toString()]);

    const result = await scanWorkspace();
    expect(result.scanned).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.cancelled).toBe(false);
    // A run with failures surfaces a WARNING (not info) so the
    // partial-success state is visible without being noisy.
    const warnings = globalThis.__stubCalls?.warningMessages ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("1 failed");
  });

  it("reports cancellation with the partial scanned count", async () => {
    globalThis.__stubFindFiles = [
      fakeUri("/r/a.yml"),
      fakeUri("/r/b.yml"),
      fakeUri("/r/c.yml"),
    ];
    // Cancel before the loop body runs so every file is skipped.
    globalThis.__stubProgressCancelled = true;
    const result = await scanWorkspace();
    expect(result.cancelled).toBe(true);
    expect(result.scanned).toBe(0);
    // Cancelled runs route the summary to a warning.
    expect(globalThis.__stubCalls?.warningMessages ?? []).toHaveLength(1);
  });
});

describe("scanWorkspace — LSP-not-ready gate", () => {
  // Without a live LSP, opening every candidate document is wasted
  // work (no didOpen recipient → no diagnostics → empty Findings) and
  // the completion toast would actively mislead the user. The gate
  // bails early and routes the user toward the install / restart
  // flow instead.

  beforeEach(() => {
    globalThis.__stubWorkspaceFolders = [
      { uri: { toString: () => "file:///r", fsPath: "/r" } },
    ];
    globalThis.__stubFindFiles = [
      { toString: () => "file:///r/Dockerfile", fsPath: "/r/Dockerfile" },
    ];
    setLspReady(false);
  });

  it("returns zero counts without touching findFiles or openTextDocument", async () => {
    const result = await scanWorkspace();
    expect(result).toEqual({ scanned: 0, failed: 0, cancelled: false });
    // The gate must short-circuit BEFORE the candidate enumeration —
    // otherwise a 50k-file workspace pays the findFiles cost just to
    // be told no.
    expect(globalThis.__stubCalls?.findFiles ?? []).toEqual([]);
  });

  it("surfaces a warning toast with actionable buttons in noisy mode", async () => {
    await scanWorkspace();
    const warnings = globalThis.__stubCalls?.warningMessages ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0].toLowerCase()).toContain("language server");
    expect(warnings[0].toLowerCase()).toContain("not running");
  });

  it("suppresses the toast in quiet mode", async () => {
    // scan-on-save uses quiet mode; a toast on every save would be
    // unbearable when the LSP is intermittently down.
    const result = await scanWorkspace({ quiet: true });
    expect(result).toEqual({ scanned: 0, failed: 0, cancelled: false });
    expect(globalThis.__stubCalls?.warningMessages ?? []).toEqual([]);
    expect(globalThis.__stubCalls?.infoMessages ?? []).toEqual([]);
  });
});
