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
