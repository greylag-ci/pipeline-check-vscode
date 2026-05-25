import { describe, it, expect, vi, beforeEach } from "vitest";

// The shared vscode stub in src/__testStubs__/vscode.ts covers the
// surface findingsView reaches into. The async factory below is the
// only safe way to share it: vi.mock hoists above imports and the
// factory cannot reference outer-scope bindings synchronously.
vi.mock("vscode", async () => {
  const { vscodeStub } = await import("./__testStubs__/vscode");
  return vscodeStub();
});

// Import after the mock is registered.
import { resetStubState } from "./__testStubs__/vscode";
import { FindingsTreeProvider, SEVERITY_ORDER } from "./findingsView";

// Per-test workspaceState fixture: a simple in-memory Memento that
// records `update` calls and serves `get` from the same map. Each
// test gets a fresh one via `freshContext()` so persistence
// assertions are isolated. The cast to `ExtensionContext` is the
// standard "only fill what the SUT touches" pattern.
function freshContext(): {
  ctx: import("vscode").ExtensionContext;
  state: Record<string, unknown>;
} {
  const state: Record<string, unknown> = {};
  const ctx = {
    subscriptions: [] as Array<{ dispose: () => void }>,
    workspaceState: {
      get<T>(key: string, fallback?: T): T | undefined {
        return (key in state ? state[key] : fallback) as T | undefined;
      },
      async update(key: string, value: unknown): Promise<void> {
        state[key] = value;
      },
      keys(): readonly string[] {
        return Object.keys(state);
      },
    },
  } as unknown as import("vscode").ExtensionContext;
  return { ctx, state };
}

// Back-compat shim for the existing tests that read `ctx` from the
// outer scope. Each new test should call `freshContext()` directly
// when it wants to assert on persisted state.
const ctx = freshContext().ctx;

// `vscode.languages.getDiagnostics()` returns `[uri, diagnostic[]][]`.
// We build that shape from a compact (severity, file, rule) triple so
// every test stays readable.
type FakeFinding = {
  file: string;
  rule: string;
  severity?: string;
  line?: number;
  docsUrl?: string;
};

function setStubDiagnostics(findings: FakeFinding[]): void {
  const grouped = new Map<string, unknown[]>();
  for (const f of findings) {
    const key = `file:///${f.file}`;
    const arr = grouped.get(key) ?? [];
    arr.push({
      source: "pipeline-check",
      message: `${f.rule} title\n\nThe long description.\n\nFix: do X.`,
      code: {
        value: f.rule,
        target: { toString: () => f.docsUrl ?? "" },
      },
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
  // Full reset (not just `__stubDiagnostics`) so the shared `__stubCalls`
  // — populated by every FindingsTreeProvider constructor via the
  // `setContext` executeCommand — doesn't accumulate across tests.
  // Currently no test asserts on that history; the reset keeps a
  // future assertion honest.
  resetStubState();
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
    expect(roots[0].kind === "group" && roots[0].description).toBe("2");
    expect(roots[1].kind === "group" && roots[1].description).toBe("1");
  });

  it("carries the workspace-relative path on the group tooltip", () => {
    // U11: description is count-only so the right edge of the tree
    // scans uniformly. The disambiguator for same-basename files in
    // different directories (workflows/release.yml vs
    // pipelines/release.yml) moves to the tooltip.
    setStubDiagnostics([
      { file: "workflows/release.yml", rule: "GHA-001", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("file");
    const roots = p.getChildren();
    const item = p.getTreeItem(roots[0]);
    expect(item.tooltip).toBe("/workflows/release.yml");
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

  it("picks the icon from the maximum severity in the bucket", () => {
    // U6: rule groups previously took items[0].severity after a sort
    // that ordered by file path + line — totally unrelated to
    // severity. A rule with one CRITICAL and four LOW findings could
    // render as the LOW icon if the CRITICAL was on the lexicographically-
    // last file. maxSeverity aggregation pins the icon to the worst case
    // so the tree's at-every-depth severity signal stays honest.
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "LOW" },
      { file: "z.yml", rule: "GHA-001", severity: "CRITICAL" },
      { file: "a.yml", rule: "GHA-001", severity: "LOW" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("rule");
    const roots = p.getChildren();
    const icon = roots[0].kind === "group" ? roots[0].icon : undefined;
    expect((icon as { id: string }).id).toBe("flame");
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

  it("leaf label is the title (first line); rule id and location ride on the description", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH", line: 22 },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    const roots = p.getChildren();
    const leaves = p.getChildren(roots[0]);
    expect(leaves.length).toBe(1);
    const item = p.getTreeItem(leaves[0]);
    expect(item.label).toBe("GHA-001 title");
    expect(item.contextValue).toBe("pipelineCheck.finding");
    expect(item.description).toBe("GHA-001 · a.yml:23");
    const cmd = (item as { command?: { command: string } }).command;
    expect(cmd?.command).toBe("vscode.open");
  });
});

describe("FindingsTreeProvider — adaptive leaf description", () => {
  // The description column avoids repeating information the parent
  // group already carries. Keeps the visual rhythm consistent across
  // group modes.

  it("severity-mode shows 'RULE · file:line' (group carries the severity)", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH", line: 4 },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    const roots = p.getChildren();
    const leaves = p.getChildren(roots[0]);
    expect(p.getTreeItem(leaves[0]).description).toBe("GHA-001 · a.yml:5");
  });

  it("file-mode shows 'RULE · Lline' (group carries the file)", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH", line: 4 },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("file");
    const roots = p.getChildren();
    const leaves = p.getChildren(roots[0]);
    expect(p.getTreeItem(leaves[0]).description).toBe("GHA-001 · L5");
  });

  it("rule-mode shows 'file:line' (group carries the rule)", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH", line: 4 },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("rule");
    const roots = p.getChildren();
    const leaves = p.getChildren(roots[0]);
    expect(p.getTreeItem(leaves[0]).description).toBe("a.yml:5");
  });

  it("converts the 0-based LSP line to 1-based display", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH", line: 0 },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("file");
    const roots = p.getChildren();
    const leaves = p.getChildren(roots[0]);
    expect(p.getTreeItem(leaves[0]).description).toBe("GHA-001 · L1");
  });

  it("omits the rule id from the description when none is present", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "", severity: "HIGH", line: 4 },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    const roots = p.getChildren();
    const leaves = p.getChildren(roots[0]);
    expect(p.getTreeItem(leaves[0]).description).toBe("a.yml:5");
  });
});

describe("FindingsTreeProvider — activity-bar badge", () => {
  // setTreeView wires the badge; refresh() and the diagnostic-change
  // listener both drive updates. Tests pin down the contract that the
  // badge tracks the visible-finding count and clears to undefined
  // when the workspace is clean.

  function fakeTreeView(): { badge: unknown } & object {
    return { badge: undefined };
  }

  it("setTreeView seeds the badge with the current finding count", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "a.yml", rule: "GHA-002", severity: "LOW" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    const view = fakeTreeView();
    p.setTreeView(view as unknown as Parameters<typeof p.setTreeView>[0]);
    expect((view.badge as { value: number }).value).toBe(2);
  });

  it("clears the badge to undefined when there are no findings", () => {
    setStubDiagnostics([]);
    const p = new FindingsTreeProvider(ctx);
    const view = fakeTreeView();
    p.setTreeView(view as unknown as Parameters<typeof p.setTreeView>[0]);
    expect(view.badge).toBeUndefined();
  });

  it("singular/plural form of the badge tooltip", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    const view = fakeTreeView();
    p.setTreeView(view as unknown as Parameters<typeof p.setTreeView>[0]);
    expect((view.badge as { tooltip: string }).tooltip).toBe(
      "1 Pipeline-Check finding",
    );

    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "a.yml", rule: "GHA-002", severity: "LOW" },
    ]);
    p.refresh();
    expect((view.badge as { tooltip: string }).tooltip).toBe(
      "2 Pipeline-Check findings",
    );
  });

  it("refresh() before setTreeView is a no-op (does not throw)", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    // No setTreeView call here — the pre-wiring window must be safe.
    expect(() => p.refresh()).not.toThrow();
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

  it("getGroupMode reflects the most recent setGroupMode call", () => {
    // The Quick Pick prompt in extension.ts reads getGroupMode() to
    // mark the active row with $(check). If the getter ever drifted
    // from the field, the Quick Pick would lie. Pinned here.
    const p = new FindingsTreeProvider(ctx);
    expect(p.getGroupMode()).toBe("severity"); // default
    p.setGroupMode("rule");
    expect(p.getGroupMode()).toBe("rule");
    p.setGroupMode("file");
    expect(p.getGroupMode()).toBe("file");
  });
});

describe("FindingsTreeProvider — rule docs link in tooltip", () => {
  // When the server publishes ``Diagnostic.code.target`` (the rule's
  // documentation URL), the leaf tooltip should carry a clickable
  // "Read more" link below the message body. When the URL is absent
  // or empty, the tooltip is just the message. The link target is
  // exactly what the server published — we don't synthesise URLs.

  it("appends a docs link when the server publishes one", () => {
    setStubDiagnostics([
      {
        file: "a.yml",
        rule: "GHA-001",
        severity: "HIGH",
        docsUrl: "https://example.com/rules/gha-001",
      },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    const roots = p.getChildren();
    const leaves = p.getChildren(roots[0]);
    const item = p.getTreeItem(leaves[0]);
    const tip = item.tooltip as { value: string; isTrusted: boolean };
    expect(tip.value).toContain("GHA-001 title");
    expect(tip.value).toContain(
      "[$(book) GHA-001 documentation](https://example.com/rules/gha-001)",
    );
    expect(tip.isTrusted).toBe(true);
  });

  it("leaves the tooltip clean when the server publishes no URL", () => {
    setStubDiagnostics([
      {
        file: "a.yml",
        rule: "GHA-001",
        severity: "HIGH",
        // no docsUrl
      },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    const roots = p.getChildren();
    const leaves = p.getChildren(roots[0]);
    const item = p.getTreeItem(leaves[0]);
    const tip = item.tooltip as { value: string };
    expect(tip.value).toContain("GHA-001 title");
    expect(tip.value).not.toContain("documentation");
  });
});

describe("FindingsTreeProvider — findings cache invalidation", () => {
  // refresh() drops the cached findings list so the next render sees
  // any new diagnostic publishes. Without invalidation, a freshly
  // published finding wouldn't appear in the tree until the user
  // toggled the group mode or restarted VS Code. The test exercises
  // the path end-to-end: render once, swap the stub data, refresh,
  // render again.

  it("refresh() picks up newly-published diagnostics", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    expect(p.getChildren()).toHaveLength(1);

    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "b.yml", rule: "GHA-002", severity: "CRITICAL" },
    ]);
    // Without refresh() the second publish would be invisible.
    p.refresh();
    const roots = p.getChildren();
    expect(roots).toHaveLength(2);
    // CRITICAL is leftmost in the sort.
    expect(roots[0].kind === "group" && roots[0].label).toBe("CRITICAL");
  });
});

describe("FindingsTreeProvider — filter", () => {
  // The filter narrows the visible tree to findings whose rule ID,
  // message, or fsPath contains the filter string (case-insensitive).
  // The badge tracks the filtered count; `lastFindingUris` keeps the
  // full set so the batch-touches-us check still wakes us up for
  // publishes that would currently be filtered out (otherwise a
  // CLEAR of a filtered-out URI would never refresh).

  function fakeTreeView(): { badge: unknown } & object {
    return { badge: undefined };
  }

  it("defaults to no filter (getFilter returns empty string)", () => {
    const p = new FindingsTreeProvider(ctx);
    expect(p.getFilter()).toBe("");
  });

  it("setFilter narrows the tree to matching rule IDs", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "b.yml", rule: "GHA-015", severity: "HIGH" },
      { file: "c.yml", rule: "GLI-002", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    expect(p.getChildren()[0]).toMatchObject({ kind: "group" });
    expect((p.getChildren()[0] as unknown as { children: unknown[] }).children).toHaveLength(
      3,
    );

    p.setFilter("GHA");
    const after = p.getChildren()[0] as unknown as { children: unknown[] };
    expect(after.children).toHaveLength(2);
  });

  it("filter is case-insensitive", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    p.setFilter("gha");
    const roots = p.getChildren();
    expect(roots).toHaveLength(1);
  });

  it("filter matches the message body, not just the rule ID", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "b.yml", rule: "GHA-002", severity: "HIGH" },
    ]);
    // Both findings have message "GHA-001 title" / "GHA-002 title"
    // because setStubDiagnostics builds the message from the rule.
    // Filtering on "title" should keep both.
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    p.setFilter("title");
    const roots = p.getChildren();
    expect((roots[0] as unknown as { children: unknown[] }).children).toHaveLength(2);
  });

  it("filter matches the fsPath", () => {
    setStubDiagnostics([
      { file: "workflows/ci.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "config/dockerfile", rule: "DOCK-001", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    p.setFilter("workflows");
    expect((p.getChildren()[0] as unknown as { children: unknown[] }).children).toHaveLength(
      1,
    );
  });

  it("empty filter clears the narrowing", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "b.yml", rule: "GLI-002", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setGroupMode("severity");
    p.setFilter("GHA");
    expect((p.getChildren()[0] as unknown as { children: unknown[] }).children).toHaveLength(
      1,
    );
    p.setFilter("");
    expect((p.getChildren()[0] as unknown as { children: unknown[] }).children).toHaveLength(
      2,
    );
  });

  it("setFilter trims whitespace before comparing for change", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    p.setFilter("  GHA  ");
    expect(p.getFilter()).toBe("GHA");
  });

  it("badge reflects the filtered count, not the workspace total", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "b.yml", rule: "GLI-002", severity: "HIGH" },
      { file: "c.yml", rule: "GHA-003", severity: "HIGH" },
    ]);
    const p = new FindingsTreeProvider(ctx);
    const view = fakeTreeView();
    p.setTreeView(view as unknown as Parameters<typeof p.setTreeView>[0]);
    expect((view.badge as { value: number }).value).toBe(3);

    p.setFilter("GHA");
    expect((view.badge as { value: number }).value).toBe(2);
  });
});

describe("FindingsTreeProvider — hidden severities", () => {
  // The panel-only severity filter lets a user mute MEDIUM while
  // triaging CRITICAL without touching the editor-wide
  // `severityThreshold` setting. State persists per workspace via
  // workspaceState so the choice survives a window reload.

  function countLeaves(roots: ReturnType<FindingsTreeProvider["getChildren"]>): number {
    let n = 0;
    for (const r of roots) {
      if (r.kind === "group") n += r.children.length;
    }
    return n;
  }

  it("defaults to showing every severity (getHiddenSeverities returns an empty set)", () => {
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    expect(p.getHiddenSeverities().size).toBe(0);
  });

  it("setHiddenSeverities filters those severities out of the tree", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "CRITICAL" },
      { file: "b.yml", rule: "GHA-002", severity: "MEDIUM" },
      { file: "c.yml", rule: "GHA-003", severity: "LOW" },
    ]);
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    p.setGroupMode("severity");
    expect(countLeaves(p.getChildren())).toBe(3);

    p.setHiddenSeverities(new Set(["MEDIUM", "LOW"]));
    const visible = p.getChildren();
    expect(visible.map((g) => (g.kind === "group" ? g.label : ""))).toEqual([
      "CRITICAL",
    ]);
    expect(countLeaves(visible)).toBe(1);
  });

  it("hidden-severity filter composes with the substring filter", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "CRITICAL" },
      { file: "b.yml", rule: "GLI-002", severity: "CRITICAL" },
      { file: "c.yml", rule: "GHA-003", severity: "MEDIUM" },
    ]);
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    p.setGroupMode("severity");
    p.setHiddenSeverities(new Set(["MEDIUM"]));
    p.setFilter("GHA");
    // Two CRITICALs survive, one MEDIUM excluded by severity, one
    // CRITICAL excluded by substring = 1 visible.
    expect(countLeaves(p.getChildren())).toBe(1);
  });

  it("setHiddenSeverities persists the choice via workspaceState", () => {
    const { ctx: ctx0, state } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    p.setHiddenSeverities(new Set(["LOW", "INFO"]));
    expect(state["pipelineCheck.findings.hiddenSeverities"]).toEqual([
      "LOW",
      "INFO",
    ]);
  });

  it("constructor restores the persisted hidden-severity set", () => {
    const { ctx: ctx0, state } = freshContext();
    state["pipelineCheck.findings.hiddenSeverities"] = ["HIGH", "INFO"];
    const p = new FindingsTreeProvider(ctx0);
    expect([...p.getHiddenSeverities()].sort()).toEqual(["HIGH", "INFO"]);
  });

  it("constructor drops unknown persisted severities silently", () => {
    // Forward/back-compat: a future severity rename or a hand-edited
    // value should not blank the tree. Anything not in SEVERITY_ORDER
    // is dropped at load time.
    const { ctx: ctx0, state } = freshContext();
    state["pipelineCheck.findings.hiddenSeverities"] = [
      "LOW",
      "BOGUS",
      "ALSO_NOT_REAL",
    ];
    const p = new FindingsTreeProvider(ctx0);
    expect([...p.getHiddenSeverities()]).toEqual(["LOW"]);
  });

  it("setHiddenSeverities with the same set is a no-op (no refresh storm)", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
    ]);
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    let fires = 0;
    p.onDidChangeTreeData(() => {
      fires += 1;
    });
    p.setHiddenSeverities(new Set(["LOW"]));
    expect(fires).toBe(1);
    p.setHiddenSeverities(new Set(["LOW"]));
    expect(fires).toBe(1); // unchanged
    p.setHiddenSeverities(new Set(["LOW", "INFO"]));
    expect(fires).toBe(2);
  });

  it("getHiddenSeverities returns a defensive copy", () => {
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    p.setHiddenSeverities(new Set(["LOW"]));
    const copy = p.getHiddenSeverities();
    copy.add("CRITICAL");
    // Mutating the returned set must not change the provider's state.
    expect([...p.getHiddenSeverities()]).toEqual(["LOW"]);
  });

  it("badge tracks visible-after-severity-filter count", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "CRITICAL" },
      { file: "b.yml", rule: "GHA-002", severity: "MEDIUM" },
      { file: "c.yml", rule: "GHA-003", severity: "LOW" },
    ]);
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    const view: { badge: unknown } & object = { badge: undefined };
    p.setTreeView(view as unknown as Parameters<typeof p.setTreeView>[0]);
    expect((view.badge as { value: number }).value).toBe(3);

    p.setHiddenSeverities(new Set(["MEDIUM", "LOW"]));
    expect((view.badge as { value: number }).value).toBe(1);
  });

  it("SEVERITY_ORDER export is what the toggle Quick Pick consumes", () => {
    // Pinning the order so the Quick Pick stays user-recognisable
    // (CRITICAL first, INFO last). The toggle command in
    // extension.ts iterates over this list.
    expect([...SEVERITY_ORDER]).toEqual([
      "CRITICAL",
      "HIGH",
      "MEDIUM",
      "LOW",
      "INFO",
    ]);
  });
});

describe("FindingsTreeProvider — filter composition edge cases", () => {
  // Severity-hide and substring-filter compose in `applyFilter`. These
  // tests pin the interactions that matter for triage UX: a rule whose
  // entire population is in a hidden severity should disappear from
  // every grouping mode; an empty workspace after filtering should
  // render as nothing (no empty-group ghost rows).

  it("hiding all severities of a rule removes its bucket from group-by-rule", () => {
    // A rule with two HIGH findings — hide HIGH → the rule bucket
    // vanishes entirely (no empty-group skeleton left behind).
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "b.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "c.yml", rule: "GHA-002", severity: "LOW" },
    ]);
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    p.setGroupMode("rule");
    expect(p.getChildren().map((g) => (g.kind === "group" ? g.label : ""))).toEqual([
      "GHA-001",
      "GHA-002",
    ]);
    p.setHiddenSeverities(new Set(["HIGH"]));
    expect(p.getChildren().map((g) => (g.kind === "group" ? g.label : ""))).toEqual([
      "GHA-002",
    ]);
  });

  it("hiding all severities of a file removes its bucket from group-by-file", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "b.yml", rule: "GHA-002", severity: "MEDIUM" },
    ]);
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    p.setGroupMode("file");
    expect(p.getChildren()).toHaveLength(2);
    p.setHiddenSeverities(new Set(["MEDIUM"]));
    const buckets = p.getChildren();
    expect(buckets).toHaveLength(1);
    expect(buckets[0].kind === "group" && buckets[0].label).toBe("a.yml");
  });

  it("hiding every severity in the workspace renders an empty tree", () => {
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "b.yml", rule: "GHA-002", severity: "LOW" },
    ]);
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    p.setHiddenSeverities(
      new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
    );
    expect(p.getChildren()).toEqual([]);
  });

  it("substring filter that matches only hidden-severity findings yields an empty tree", () => {
    // The substring filter narrows to GHA-001, but GHA-001 is HIGH
    // and HIGH is hidden → no leaves left, no group buckets either.
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "b.yml", rule: "GHA-002", severity: "LOW" },
    ]);
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    p.setHiddenSeverities(new Set(["HIGH"]));
    p.setFilter("GHA-001");
    expect(p.getChildren()).toEqual([]);
  });

  it("substring filter and severity-hide together do not double-count in the badge", () => {
    // Three findings: two filtered out by substring, one by severity.
    // Badge must be 1 (the LOW-severity GHA-001), not 2 (counting the
    // GHA-001 once per filter pass).
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "LOW" },
      { file: "b.yml", rule: "GHA-001", severity: "HIGH" },
      { file: "c.yml", rule: "GLI-002", severity: "LOW" },
    ]);
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    const view: { badge: unknown } & object = { badge: undefined };
    p.setTreeView(view as unknown as Parameters<typeof p.setTreeView>[0]);
    expect((view.badge as { value: number }).value).toBe(3);
    p.setFilter("GHA");
    p.setHiddenSeverities(new Set(["HIGH"]));
    expect((view.badge as { value: number }).value).toBe(1);
  });

  it("max-severity icon on a rule group reflects the visible-only severity, not the hidden one", () => {
    // A rule with one CRITICAL + four LOW findings should render with
    // the FLAME icon. Once CRITICAL is hidden, the same rule's icon
    // should drop to LOW's blue circle — the bucket's max-severity
    // computation runs over the FILTERED list, not the raw one.
    setStubDiagnostics([
      { file: "a.yml", rule: "GHA-001", severity: "CRITICAL" },
      { file: "b.yml", rule: "GHA-001", severity: "LOW" },
      { file: "c.yml", rule: "GHA-001", severity: "LOW" },
    ]);
    const { ctx: ctx0 } = freshContext();
    const p = new FindingsTreeProvider(ctx0);
    p.setGroupMode("rule");
    {
      const root = p.getChildren()[0];
      const icon = root.kind === "group" ? root.icon : undefined;
      expect((icon as { id: string }).id).toBe("flame");
    }
    p.setHiddenSeverities(new Set(["CRITICAL"]));
    {
      const root = p.getChildren()[0];
      const icon = root.kind === "group" ? root.icon : undefined;
      expect((icon as { id: string }).id).toBe("info");
    }
  });
});
