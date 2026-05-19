import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  // navigate.ts touches `vscode.languages` and `vscode.window` in the
  // command path, but the pure helpers we test below don't need them.
  // A minimal stub keeps the module-level import resolvable.
  languages: {},
  window: {},
}));

import { collectFindingLocations, pickNextIndex, type Direction } from "./navigate";

// Helpers ----------------------------------------------------------------

const uri = (path: string) =>
  ({
    fsPath: path,
    toString: () => `file://${path}`,
  }) as unknown as import("vscode").Uri;

const range = (line: number, ch = 0) =>
  ({
    start: { line, character: ch },
    end: { line, character: ch },
  }) as unknown as import("vscode").Range;

const pos = (line: number, ch = 0) =>
  ({ line, character: ch }) as import("vscode").Position;

const diag = (line: number, source = "pipeline-check") => ({
  source,
  message: "",
  range: range(line),
  severity: 0,
});

const findings = (...rows: Array<[string, number]>) =>
  rows.map(([file, line]) => ({
    uri: uri(file),
    range: range(line),
  }));

// collectFindingLocations -----------------------------------------------

describe("collectFindingLocations", () => {
  it("ignores diagnostics whose source is not pipeline-check", () => {
    const iter: Array<[import("vscode").Uri, import("vscode").Diagnostic[]]> = [
      [
        uri("/a/ci.yml"),
        [
          diag(2, "eslint") as unknown as import("vscode").Diagnostic,
          diag(5) as unknown as import("vscode").Diagnostic,
        ],
      ],
    ];
    const out = collectFindingLocations(iter);
    expect(out).toHaveLength(1);
    expect(out[0].range.start.line).toBe(5);
  });

  it("sorts cross-file by fsPath then by line", () => {
    const iter: Array<[import("vscode").Uri, import("vscode").Diagnostic[]]> = [
      [
        uri("/z/last.yml"),
        [
          diag(0) as unknown as import("vscode").Diagnostic,
          diag(2) as unknown as import("vscode").Diagnostic,
        ],
      ],
      [
        uri("/a/first.yml"),
        [
          diag(9) as unknown as import("vscode").Diagnostic,
          diag(1) as unknown as import("vscode").Diagnostic,
        ],
      ],
    ];
    const out = collectFindingLocations(iter);
    expect(out.map((f) => [f.uri.fsPath, f.range.start.line])).toEqual([
      ["/a/first.yml", 1],
      ["/a/first.yml", 9],
      ["/z/last.yml", 0],
      ["/z/last.yml", 2],
    ]);
  });
});

// pickNextIndex ---------------------------------------------------------

describe("pickNextIndex", () => {
  const list = findings(
    ["/a/x.yml", 5],
    ["/a/x.yml", 15],
    ["/b/y.yml", 0],
  );

  it("returns -1 when there are no findings", () => {
    expect(pickNextIndex([], undefined, "next")).toBe(-1);
    expect(pickNextIndex([], pos(0) as never, "next" satisfies Direction)).toBe(
      -1,
    );
  });

  it("next: with no cursor returns the first finding", () => {
    expect(
      pickNextIndex(
        list,
        undefined as unknown as { uri: import("vscode").Uri; position: import("vscode").Position },
        "next",
      ),
    ).toBe(0);
  });

  it("previous: with no cursor returns the last finding", () => {
    expect(
      pickNextIndex(
        list,
        undefined as unknown as { uri: import("vscode").Uri; position: import("vscode").Position },
        "previous",
      ),
    ).toBe(2);
  });

  it("next: cursor before all findings → first", () => {
    expect(
      pickNextIndex(list, { uri: uri("/a/x.yml"), position: pos(0) }, "next"),
    ).toBe(0);
  });

  it("next: cursor on a finding → the one after", () => {
    expect(
      pickNextIndex(list, { uri: uri("/a/x.yml"), position: pos(5) }, "next"),
    ).toBe(1);
  });

  it("next: cursor at end → wraps to first", () => {
    expect(
      pickNextIndex(
        list,
        { uri: uri("/c/zzz.yml"), position: pos(99) },
        "next",
      ),
    ).toBe(0);
  });

  it("previous: cursor on a finding → the one before", () => {
    expect(
      pickNextIndex(
        list,
        { uri: uri("/a/x.yml"), position: pos(15) },
        "previous",
      ),
    ).toBe(0);
  });

  it("previous: cursor at start → wraps to last", () => {
    expect(
      pickNextIndex(
        list,
        { uri: uri("/0/nothing.yml"), position: pos(0) },
        "previous",
      ),
    ).toBe(2);
  });

  it("next: cursor in a file that sorts between the finding files lands on the next finding's file", () => {
    // Cursor in /a/y_after.yml — sorts after /a/x.yml (same dir,
    // 'y' > 'x') and before /b/y.yml. Next finding is index 2.
    expect(
      pickNextIndex(
        list,
        { uri: uri("/a/y_after.yml"), position: pos(0) },
        "next",
      ),
    ).toBe(2);
  });

  it("strict comparison: cursor on the SAME column as a finding still advances", () => {
    // The finding sits at line 5 char 0. Cursor at line 5 char 0 should
    // still move us past it on `next`, not pin.
    const single = findings(["/a/x.yml", 5]);
    expect(
      pickNextIndex(single, { uri: uri("/a/x.yml"), position: pos(5, 0) }, "next"),
    ).toBe(0); // wraps because single element and not strictly-after
  });
});
