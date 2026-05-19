// Custom panel that re-groups Pipeline-Check diagnostics by severity,
// file, or rule. The Problems panel groups only by file; the editor
// gutter shows squiggles only for the file in front. Neither answers
// "how many CRITICAL findings does this workspace have right now?"
// at a glance. This view does — strictly as a re-presentation of the
// diagnostics the LSP server has already published. It never triggers
// its own scan, so the thin-transport-adapter promise in extension.ts
// stays intact.

import * as vscode from "vscode";

// Diagnostics from other extensions (eslint, mypy, redhat.yaml schema
// validation) flow through the same publish stream we read from. Filter
// by ``source`` so the panel only ever shows our findings.
const DIAGNOSTIC_SOURCE = "pipeline-check";

// Order matters twice: it picks the bucket ordering in the "by
// severity" group (most severe first), and it is the fallback if a
// diagnostic arrives without the pipeline-check ``data.severity``
// extension (older server, or anything we didn't publish).
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
type SeverityName = (typeof SEVERITY_ORDER)[number];

// Per-bucket icon. CRITICAL renders as ``flame`` (still red-themed)
// so the severity-grouped tree can distinguish CRITICAL from HIGH at
// a glance; the editor gutter does not have a "more red than red"
// state so it still collapses the two — that asymmetry is fine
// because the gutter and the tree answer different questions.
// INFO uses a full-size codicon themed to ``descriptionForeground``
// so it is visibly the quietest row instead of inheriting the
// default foreground (which in dark themes is brighter than LOW's
// blue, inverting the severity gradient).
const SEVERITY_ICON: Record<SeverityName, vscode.ThemeIcon> = {
  CRITICAL: new vscode.ThemeIcon(
    "flame",
    new vscode.ThemeColor("errorForeground"),
  ),
  HIGH: new vscode.ThemeIcon(
    "error",
    new vscode.ThemeColor("errorForeground"),
  ),
  MEDIUM: new vscode.ThemeIcon(
    "warning",
    new vscode.ThemeColor("editorWarning.foreground"),
  ),
  LOW: new vscode.ThemeIcon(
    "info",
    new vscode.ThemeColor("editorInfo.foreground"),
  ),
  INFO: new vscode.ThemeIcon(
    "circle-outline",
    new vscode.ThemeColor("descriptionForeground"),
  ),
};

// Numeric rank for ``maxSeverity`` aggregation. Mirrors the order in
// SEVERITY_ORDER but inverted so a higher number means more severe —
// matches ``Math.max`` semantics naturally.
const SEVERITY_RANK: Record<SeverityName, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

export type GroupMode = "severity" | "file" | "rule";

type Finding = {
  readonly uri: vscode.Uri;
  readonly diagnostic: vscode.Diagnostic;
  readonly severity: SeverityName;
  readonly ruleId: string;
};

type GroupNode = {
  readonly kind: "group";
  readonly label: string;
  readonly icon?: vscode.ThemeIcon;
  readonly description?: string;
  // Used in file-mode to carry the workspace-relative path without
  // burning description-column width. Group descriptions stay
  // count-only so the right-edge of the tree scans uniformly.
  readonly tooltip?: string;
  readonly children: readonly TreeNode[];
};

type LeafNode = {
  readonly kind: "leaf";
  readonly finding: Finding;
};

type TreeNode = GroupNode | LeafNode;

export class FindingsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private groupMode: GroupMode = "severity";
  // Two-phase wiring: the view is created with the provider as an
  // argument (constructor side), then the caller hands the view back
  // via setTreeView so we can drive its ``badge``. The optional type
  // makes the pre-wiring window explicit — refresh() called before
  // setTreeView simply skips the badge update.
  private treeView: vscode.TreeView<TreeNode> | undefined;

  constructor(context: vscode.ExtensionContext) {
    // VS Code does not expose a per-source filter on the diagnostic-
    // change event, so we re-render on every publish. collectFindings
    // re-filters by source, so the rendered tree only changes when a
    // pipeline-check publish actually arrives.
    context.subscriptions.push(
      vscode.languages.onDidChangeDiagnostics(() => this.refresh()),
    );
    // Seed the context key the title-bar menu reads to highlight the
    // active group mode. Must run after the view is registered to
    // take effect; activate() does that immediately after constructing
    // the provider.
    void vscode.commands.executeCommand(
      "setContext",
      "pipelineCheck.groupMode",
      this.groupMode,
    );
  }

  setTreeView(view: vscode.TreeView<TreeNode>): void {
    this.treeView = view;
    this.updateBadge();
  }

  getGroupMode(): GroupMode {
    return this.groupMode;
  }

  setGroupMode(mode: GroupMode): void {
    if (this.groupMode === mode) {
      return;
    }
    this.groupMode = mode;
    void vscode.commands.executeCommand(
      "setContext",
      "pipelineCheck.groupMode",
      mode,
    );
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
    this.updateBadge();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "group") {
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = node.icon;
      item.description = node.description;
      if (node.tooltip) {
        item.tooltip = node.tooltip;
      }
      item.contextValue = "pipelineCheck.group";
      return item;
    }
    return this.leafItem(node.finding);
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return this.buildRoot();
    }
    // Leaves are constructed with ``CollapsibleState.None``; VS Code
    // never asks them for children. Group nodes are the only thing
    // we expand.
    return node.kind === "group" ? [...node.children] : [];
  }

  private leafItem(f: Finding): vscode.TreeItem {
    // The server composes "title\n\ndescription\n\nFix: ..." (see
    // diagnostics.py:_compose_message); the first line is the title
    // and the rest belongs in the tooltip. Markdown handles the
    // paragraph rhythm on its own — no need for explicit dividers.
    const title = f.diagnostic.message.split("\n", 1)[0];
    const item = new vscode.TreeItem(
      title,
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = SEVERITY_ICON[f.severity];
    item.description = composeLeafDescription(f, this.groupMode);
    item.tooltip = new vscode.MarkdownString(f.diagnostic.message);
    item.command = {
      command: "vscode.open",
      title: "Reveal finding",
      arguments: [
        f.uri,
        {
          selection: f.diagnostic.range,
          preserveFocus: false,
          preview: true,
        } satisfies vscode.TextDocumentShowOptions,
      ],
    };
    item.contextValue = "pipelineCheck.finding";
    return item;
  }

  private buildRoot(): TreeNode[] {
    const all = collectFindings();
    if (all.length === 0) {
      return [];
    }
    switch (this.groupMode) {
      case "severity":
        return groupBySeverity(all);
      case "file":
        return groupByFile(all);
      case "rule":
        return groupByRule(all);
    }
  }

  private updateBadge(): void {
    if (!this.treeView) {
      return;
    }
    const total = collectFindings().length;
    this.treeView.badge =
      total === 0
        ? undefined
        : {
            value: total,
            tooltip: `${total} Pipeline-Check finding${total === 1 ? "" : "s"}`,
          };
  }
}

// Compose the description column for a leaf row. The format adapts
// to the active grouping so we never repeat information the parent
// group already carries:
//
//   severity-mode → "GHA-001 · release.yml:23"
//   file-mode     → "GHA-001 · L23"   (file is the parent)
//   rule-mode     → "release.yml:23"  (rule is the parent)
//
// The ``file.yml:23`` form mirrors what compilers emit and what
// VS Code's status bar uses — familiar at a glance.
function composeLeafDescription(f: Finding, mode: GroupMode): string {
  const line = f.diagnostic.range.start.line + 1;
  const fileRef = `${basenameFromUri(f.uri)}:${line}`;
  const parts: string[] = [];
  if (mode === "file") {
    if (f.ruleId) {
      parts.push(f.ruleId);
    }
    parts.push(`L${line}`);
  } else if (mode === "rule") {
    parts.push(fileRef);
  } else {
    if (f.ruleId) {
      parts.push(f.ruleId);
    }
    parts.push(fileRef);
  }
  return parts.join(" · ");
}

function collectFindings(): Finding[] {
  const out: Finding[] = [];
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    for (const diag of diags) {
      if (diag.source !== DIAGNOSTIC_SOURCE) {
        continue;
      }
      out.push({
        uri,
        diagnostic: diag,
        severity: readSeverity(diag),
        ruleId: readRuleId(diag),
      });
    }
  }
  return out;
}

function readSeverity(diag: vscode.Diagnostic): SeverityName {
  // diagnostics.py stuffs the upstream severity NAME into
  // ``Diagnostic.data["severity"]``. vscode-languageclient passes
  // that through unchanged. Anything missing or unknown falls back to
  // INFO so the row still renders rather than vanishing.
  const data = (diag as vscode.Diagnostic & {
    data?: { severity?: string };
  }).data;
  const sevName = (data?.severity ?? "").toUpperCase();
  return (SEVERITY_ORDER as readonly string[]).includes(sevName)
    ? (sevName as SeverityName)
    : "INFO";
}

function readRuleId(diag: vscode.Diagnostic): string {
  // ``Diagnostic.code`` can be a string, a number, or a
  // ``{ value, target }`` object depending on whether
  // ``codeDescription.href`` is set on the server side. We set it,
  // so we usually get the object form.
  if (typeof diag.code === "string") {
    return diag.code;
  }
  if (typeof diag.code === "number") {
    return String(diag.code);
  }
  if (diag.code && typeof diag.code === "object") {
    return String(diag.code.value);
  }
  return "";
}

function maxSeverity(findings: readonly Finding[]): SeverityName {
  // Empty input would mean an empty bucket reached the icon-picking
  // step, which the callers prevent. Defensive return keeps the
  // return type narrow.
  let best: SeverityName = "INFO";
  for (const f of findings) {
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[best]) {
      best = f.severity;
    }
  }
  return best;
}

function groupBySeverity(findings: readonly Finding[]): GroupNode[] {
  const buckets = new Map<SeverityName, Finding[]>();
  for (const f of findings) {
    const arr = buckets.get(f.severity) ?? [];
    arr.push(f);
    buckets.set(f.severity, arr);
  }
  const groups: GroupNode[] = [];
  for (const sev of SEVERITY_ORDER) {
    const items = buckets.get(sev);
    if (!items || items.length === 0) {
      continue;
    }
    items.sort(compareByLocation);
    groups.push({
      kind: "group",
      label: sev,
      icon: SEVERITY_ICON[sev],
      description: String(items.length),
      children: items.map((finding) => ({ kind: "leaf", finding })),
    });
  }
  return groups;
}

function groupByFile(findings: readonly Finding[]): GroupNode[] {
  const buckets = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.uri.toString();
    const arr = buckets.get(key) ?? [];
    arr.push(f);
    buckets.set(key, arr);
  }
  return [...buckets]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, items]): GroupNode => {
      const uri = vscode.Uri.parse(key);
      items.sort(compareByLocation);
      // Parent dir moves to the tooltip so the description column
      // stays count-only across all three group modes — a uniform
      // right edge is easier to scan than the mixed
      // "5 · workflows" / "5" / "5" shapes we had before. The
      // basename alone disambiguates inside the same directory; the
      // tooltip handles same-basename-different-directory collisions
      // (workflows/release.yml vs pipelines/release.yml).
      return {
        kind: "group",
        label: basenameFromUri(uri),
        icon: new vscode.ThemeIcon("file"),
        description: String(items.length),
        tooltip: workspaceRelative(uri),
        children: items.map((finding) => ({ kind: "leaf", finding })),
      };
    });
}

function groupByRule(findings: readonly Finding[]): GroupNode[] {
  const buckets = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.ruleId || "(unknown rule)";
    const arr = buckets.get(key) ?? [];
    arr.push(f);
    buckets.set(key, arr);
  }
  return [...buckets]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([rule, items]): GroupNode => {
      items.sort(compareByLocation);
      return {
        kind: "group",
        // Aggregate by max severity so a rule with one CRITICAL +
        // four LOW findings reads as red, not blue. (The previous
        // implementation picked items[0] after a path/line sort —
        // the icon was effectively random with respect to severity.)
        label: rule,
        icon: SEVERITY_ICON[maxSeverity(items)],
        description: String(items.length),
        children: items.map((finding) => ({ kind: "leaf", finding })),
      };
    });
}

function compareByLocation(a: Finding, b: Finding): number {
  const lhs = a.uri.toString();
  const rhs = b.uri.toString();
  if (lhs !== rhs) {
    return lhs.localeCompare(rhs);
  }
  return a.diagnostic.range.start.line - b.diagnostic.range.start.line;
}

function basenameFromUri(uri: vscode.Uri): string {
  const path = uri.fsPath || uri.path;
  const sepIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return sepIndex >= 0 ? path.slice(sepIndex + 1) : path;
}

function workspaceRelative(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false);
}
