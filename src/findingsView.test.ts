import { describe, it, expect, vi, beforeEach } from "vitest";

// findingsView.ts imports `vscode` at the top, which is supplied by the
// editor at runtime and isn't installable from npm. We stub just the
// surface findingsView actually touches: classes it instantiates
// (`ThemeIcon`, `ThemeColor`, `EventEmitter`, `TreeItem`,
// `MarkdownString`, `Uri`) plus the static method it calls
// (`workspace.asRelativePath`, `languages.getDiagnostics`,
// `languages.onDidChangeDiagnostics`, `commands.executeCommand`).
//
// `vi.mock` must run before the SUT is imported. The factory must not
// reference outer-scope variables (vitest hoists it), so the mutable
// state (`stubDiagnostics`) lives on `globalThis` and the
// `getDiagnostics` stub reads from there.
vi.mock("vscode", () => {
  class ThemeIcon {
    constructor(
      public readonly id: string,
      public readonly color?: ThemeColor,
    ) {}
  }
  class ThemeColor {
    constructor(public readonly id: string) {}
  }
  class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    fire(e: T): void {
      for (const l of this.listeners) l(e);
    }
    get event() {
      return (listener: (e: T) => void) => {
        this.listeners.push(listener);
        return { dispose: () => undefined };
      };
    }
    dispose(): void {
      this.listeners = [];
    }
  }
  class TreeItem {
    iconPath?: unknown;
    description?: string;
    tooltip?: unknown;
    command?: unknown;
    contextValue?: string;
    constructor(
      public readonly label: string,
      public readonly collapsibleState: number,
    ) {}
  }
  class MarkdownString {
    constructor(public readonly value: string) {}
  }
  const Uri = {
    parse: (s: string) => {
      const noScheme = s.replace(/^file:\/\//, "");
      return {
        toString: () => s,
        path: noScheme,
        fsPath: noScheme,
      };
    },
  };
  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
  return {
    ThemeIcon,
    ThemeColor,
    EventEmitter,
    TreeItem,
    MarkdownString,
    TreeItemCollapsibleState,
    Uri,
    workspace: {
      asRelativePath: (uri: { fsPath?: string; path?: string }) =>
        uri.fsPath ?? uri.path ?? "",
    },
    languages: {
      getDiagnostics: () =>
        (globalThis as { __stubDiagnostics?: unknown[] }).__stubDiagnostics ??
        [],
      onDidChangeDiagnostics: () => ({ dispose: () => undefined }),
    },
    commands: { executeCommand: () => Promise.resolve() },
  };
});

// Import after the mock is registered.
import { FindingsTreeProvider } from "./findingsView";

const ctx = {
  subscriptions: [] as Array<{ dispose: () => void }>,
} as unknown as import("vscode").ExtensionContext;

// `vscode.languages.getDiagnostics()` returns `[uri, diagnostic[]][]`.
// We build that shape from a compact (severity, file, rule) triple so
// every test stays readable.
type FakeFinding = {
  file: string;
  rule: string;
  severity?: string;
  line?: number;
};

function setStubDiagnostics(findings: FakeFinding[]): void {
  const grouped = new Map<string, unknown[]>();
  for (const f of findings) {
    const key = `file:///${f.file}`;
    const arr = grouped.get(key) ?? [];
    arr.push({
      source: "pipeline-check",
      message: `${f.rule} title\n\nThe long description.\n\nFix: do X.`,
      code: { value: f.rule, target: { toString: () => "" } },
      range: {
        start: { line: f.line ?? 0, character: 0 },
        end: { line: f.line ?? 0, character: 0 },
      },
      severity: 0,
      data: f.severity ? { severity: f.severity } : undefined,
    });
    grouped.set(key, arr);
  }
  const out: Array<[unknown, unknown[]]> = [];
  for (const [uri, diags] of grouped) {
    // Match the shape returned by `languages.getDiagnostics()`: a list
    // of [Uri, Diagnostic[]] pairs.
    out.push([
      {
        toString: () => uri,
        path: `/${uri.split("///")[1]}`,
        fsPath: `/${uri.split("///")[1]}`,
      },
      diags,
    ]);
  }
  (globalThis as { __stubDiagnostics?: unknown }).__stubDiagnostics = out;
}

beforeEach(() => {
  (globalThis as { __stubDiagnostics?: unknown }).__stubDiagnostics = [];
});

describe("FindingsTreeProvider — collection from diagnostics", () => {
  it("ignores diagnostics whose source is not pipeline-check", () => {
    const noise = {
      toString: () => "file:///workflows/ci.yml",
      path: "/workflows/ci.yml",
      fsPath: "/workflows/ci.yml",
    };
    (globalThis as { __stubDiagnostics?: unknown }).__stubDiagnostics = [
      [
        noise,
        [
          {
            source: "eslint",
            message: "not us",
            code: "ESLINT-001",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            severity: 0,
          },
        ],
      ],
    ];
    const p = new FindingsTreeProvider(ctx);
    const roots = p.getChildren();
    expect(roots).toEqual([]);
  });

  it("returns an empty tree when there are no findings", () => {
    setStubDiagnostics([]);
    const p = new FindingsTreeProvider(ctx);
    expect(p.getChildren()).toEqual([]);
  });
});

describe("FindingsTreeProvider — group by severity", () => {
  it("orders buckets CRITICAL → HIGH → MEDIUM → LOW → INFO and reports counts", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "LOW" },
      { file: "a.yml", rule: "GHA-002", severity: "CRITICAL" },
      { file: "b.yml", rule: "GHA-003", severity: "HIGH" },
      { file: "b.yml", rule: "GHA-004", severity: "CRITICAL" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    const roots = p.getChildren();

    const labels = roots.map((n) => (n.kind === "group" ? n.label : ""));
    expect(labels).toEqual(["CRITICAL", "HIGH", "LOW"]);

    const counts = roots.map((n) => (n.kind === "group" ? n.description : ""));
    expect(counts).toEqual(["2", "1", "1"]);
  });

  it("falls back to INFO for missing/unknown severity", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001" }, // missing
      { file: "a.yml", rule: "GHA-002", severity: "BOGUS" }, // unknown
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    const roots = p.getChildren();
    const labels = roots.map((n) => (n.kind === "group" ? n.label : ""));
    expect(labels).toEqual(["INFO"]);
    expect(roots[0].kind === "group" && roots[0].children).toHaveLength(2);
  });

  it("normalises lowercase data.severity to uppercase", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "high" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    const roots = p.getChildren();
    expect(roots.map((n) => (n.kind === "group" ? n.label : ""))).toEqual([
      "HIGH",
    ]);
  });
});

describe("FindingsTreeProvider — group by file", () => {
  it("buckets findings by URI, sorted alphabetically", () => {
    setStubDiagnostics([
      { file: "z/last.yml", rule: "X", severity: "LOW" },
      { file: "a/first.yml", rule: "Y", severity: "LOW" },
      { file: "a/first.yml", rule: "Z", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("file");
    const roots = p.getChildren();
    const labels = roots.map((n) => (n.kind === "group" ? n.label : ""));
    expect(labels).toEqual(["first.yml", "last.yml"]);
    expect(roots[0].kind === "group" && roots[0].description).toMatch(/^2 ·/);
    expect(roots[1].kind === "group" && roots[1].description).toMatch(/^1 ·/);
  });
});

describe("FindingsTreeProvider — group by rule", () => {
  it("buckets findings by rule id, sorted alphabetically", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-002", severity: "LOW" },
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "b.yml", rule: "GHA-001", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("rule");
    const roots = p.getChildren();
    const labels = roots.map((n) => (n.kind === "group" ? n.label : ""));
    expect(labels).toEqual(["GHA-001", "GHA-002"]);
    expect(roots[0].kind === "group" && roots[0].description).toBe("2");
    expect(roots[1].kind === "group" && roots[1].description).toBe("1");
  });

  it("places missing rule ids under '(unknown rule)'", () => {
    setStubDiagnostics([{ file: "a.yml", rule: "", severity: "LOW" }]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("rule");
    const roots = p.getChildren();
    expect(roots.map((n) => (n.kind === "group" ? n.label : ""))).toEqual([
      "(unknown rule)",
    ]);
  });
});

describe("FindingsTreeProvider — leaf items", () => {
  it("getTreeItem on a group node sets the expected description and contextValue", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "a.yml", rule: "GHA-002", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    const roots = p.getChildren();
    expect(roots.length).toBe(1);
    const item = p.getTreeItem(roots[0]);
    expect(item.description).toBe("2");
    expect(item.contextValue).toBe("pipelineCheck.group");
  });

  it("leaf item carries the rule id, first line as title, and a reveal command", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    const roots = p.getChildren();
    const leaves = p.getChildren(roots[0]);
    expect(leaves.length).toBe(1);
    const item = p.getTreeItem(leaves[0]);
    expect(item.label).toBe("GHA-001: GHA-001 title");
    expect(item.contextValue).toBe("pipelineCheck.finding");
    const cmd = (item as { command?: { command: string } }).command;
    expect(cmd?.command).toBe("vscode.open");
  });
});

describe("FindingsTreeProvider — group mode behaviour", () => {
  it("setGroupMode of the same mode is a no-op (no refresh storm)", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    let fires = 0;
    p.onDidChangeTreeData(() => {
      fires += 1;
    });
    p.setGroupMode("severity");
    p.setGroupMode("severity");
    expect(fires).toBe(0);
    p.setGroupMode("file");
    expect(fires).toBe(1);
  });
});
