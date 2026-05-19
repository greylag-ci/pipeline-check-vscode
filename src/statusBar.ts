// Status bar item that surfaces pipeline-check finding counts at the
// bottom-left of the window, so users get glanceable feedback without
// opening the Findings panel. Clicking the item reveals the panel.
//
// The visible-counts logic lives in `formatStatusBarText` as a pure
// function so the tests can pin the copy without booting VS Code.

import * as vscode from "vscode";

const DIAGNOSTIC_SOURCE = "pipeline-check";

// What we read off ``Diagnostic.data.severity``. Mirrors the
// SEVERITY_ORDER in findingsView.ts; kept local here so the status
// bar can ship without a circular import.
type SeverityName = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface SeverityCounts {
  readonly CRITICAL: number;
  readonly HIGH: number;
  readonly MEDIUM: number;
  readonly LOW: number;
  readonly INFO: number;
}

const ZERO_COUNTS: SeverityCounts = {
  CRITICAL: 0,
  HIGH: 0,
  MEDIUM: 0,
  LOW: 0,
  INFO: 0,
};

/**
 * Render the status bar text from a per-severity tally. The output
 * leans on the highest two severities present so the bar stays short
 * (status-bar items steal horizontal space from everything to their
 * right). Specifically:
 *
 *   - no findings        → "$(shield) clean"
 *   - critical present   → "$(shield) 3C 1H"      (or just "3C")
 *   - high but no crit   → "$(shield) 4H 2M"
 *   - medium and below   → "$(shield) 5"          (total count, no letter)
 */
export function formatStatusBarText(c: SeverityCounts): string {
  if (c.CRITICAL === 0 && c.HIGH === 0 && c.MEDIUM === 0 && c.LOW === 0 && c.INFO === 0) {
    return "$(shield) clean";
  }
  const parts: string[] = [];
  if (c.CRITICAL > 0) {
    parts.push(`${c.CRITICAL}C`);
    if (c.HIGH > 0) {
      parts.push(`${c.HIGH}H`);
    }
  } else if (c.HIGH > 0) {
    parts.push(`${c.HIGH}H`);
    if (c.MEDIUM > 0) {
      parts.push(`${c.MEDIUM}M`);
    }
  } else {
    // No critical or high — collapse to a single total so the bar
    // doesn't shout for noise.
    const total = c.MEDIUM + c.LOW + c.INFO;
    parts.push(String(total));
  }
  return `$(shield) ${parts.join(" ")}`;
}

/**
 * Render the tooltip — a longer breakdown shown on hover. Always
 * lists every nonzero bucket, so the abbreviated bar text never
 * hides information; just makes it less prominent.
 *
 * The trailing hint ("Click… Alt+F8…") doubles as keyboard-shortcut
 * discovery: most users find Alt+F8 here, not by reading the README.
 */
export function formatStatusBarTooltip(c: SeverityCounts): string {
  const total = c.CRITICAL + c.HIGH + c.MEDIUM + c.LOW + c.INFO;
  if (total === 0) {
    return "Pipeline-Check: no findings";
  }
  const lines = [
    `Pipeline-Check: ${total} finding${total === 1 ? "" : "s"}`,
  ];
  for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const) {
    if (c[sev] > 0) {
      lines.push(`  ${sev}: ${c[sev]}`);
    }
  }
  lines.push("Click to open the Findings panel.");
  lines.push("Alt+F8 / Shift+Alt+F8 to step through findings.");
  return lines.join("\n");
}

/**
 * Render a screen-reader-friendly version of the status bar text.
 * Codicons like ``$(shield)`` are read aloud as "shield" by some
 * narrators and skipped by others; the abbreviation "3C 1H" reads
 * as letter-by-letter spelling. The accessible label uses full
 * words for both the icon role and the counts.
 */
export function formatStatusBarAccessibilityLabel(c: SeverityCounts): string {
  const total = c.CRITICAL + c.HIGH + c.MEDIUM + c.LOW + c.INFO;
  if (total === 0) {
    return "Pipeline-Check: no findings";
  }
  const parts: string[] = [];
  for (const [name, count] of [
    ["critical", c.CRITICAL],
    ["high", c.HIGH],
    ["medium", c.MEDIUM],
    ["low", c.LOW],
    ["info", c.INFO],
  ] as const) {
    if (count > 0) {
      parts.push(`${count} ${name}`);
    }
  }
  return `Pipeline-Check: ${parts.join(", ")}`;
}

/**
 * Tally pipeline-check diagnostics across the workspace by severity.
 * Falls back to INFO when ``data.severity`` is missing or unknown
 * (same rule the Findings tree uses).
 */
export function countDiagnostics(
  iter: Iterable<readonly [unknown, readonly vscode.Diagnostic[]]>,
): SeverityCounts {
  const counts = { ...ZERO_COUNTS } as { -readonly [K in SeverityName]: number };
  for (const [, diags] of iter) {
    for (const d of diags) {
      if (d.source !== DIAGNOSTIC_SOURCE) continue;
      const name = readSeverity(d);
      counts[name] += 1;
    }
  }
  return counts;
}

function readSeverity(diag: vscode.Diagnostic): SeverityName {
  const data = (diag as vscode.Diagnostic & {
    data?: { severity?: string };
  }).data;
  const name = (data?.severity ?? "").toUpperCase();
  switch (name) {
    case "CRITICAL":
    case "HIGH":
    case "MEDIUM":
    case "LOW":
    case "INFO":
      return name;
    default:
      return "INFO";
  }
}

/**
 * Pick the status bar's background color from the per-severity tally.
 *
 *   - any CRITICAL  → `statusBarItem.errorBackground`   (red)
 *   - any HIGH      → `statusBarItem.warningBackground` (yellow)
 *   - everything else → `undefined` (default fg, blends with the bar)
 *
 * The two named ThemeColor tokens are VS Code's standard status-bar
 * severity colors — ESLint and Error Lens use the same ones, so the
 * visual language reads correctly to existing VS Code users without
 * any per-theme custom CSS.
 */
export function pickBackgroundColor(
  c: SeverityCounts,
): vscode.ThemeColor | undefined {
  if (c.CRITICAL > 0) {
    return new vscode.ThemeColor("statusBarItem.errorBackground");
  }
  if (c.HIGH > 0) {
    return new vscode.ThemeColor("statusBarItem.warningBackground");
  }
  return undefined;
}

// File patterns that suggest the current workspace is worth showing
// the status bar in. Mirrors providers.ts's TRIGGER_PATTERNS — kept
// inline here so the status bar can ship without a circular import
// (providers.ts is consumed by extension.ts which orchestrates this
// module).
const WORKSPACE_HAS_CI_GLOB =
  "{**/.github/workflows/*.yml,**/.github/workflows/*.yaml,**/.gitlab-ci.yml,**/azure-pipelines.yml,**/bitbucket-pipelines.yml,**/.circleci/config.yml,**/cloudbuild.yaml,**/.buildkite/pipeline.yml,**/.drone.yml,**/.drone.yaml,**/Jenkinsfile,**/Dockerfile,**/Containerfile}";

/**
 * Wire up the status bar item. Returns the item the caller pushes
 * onto the extension's subscriptions so it's removed on deactivate.
 * The item rewires on every diagnostic change and navigates to the
 * Findings panel on click.
 *
 * Visibility policy: the item is hidden until we observe either at
 * least one scannable file in the workspace or at least one
 * pipeline-check diagnostic. This keeps the status bar quiet for
 * users who installed Pipeline-Check but currently have a frontend
 * project (or anything else without CI files) open — common in
 * monorepo / multi-window setups. Once the workspace has been
 * "seen" as relevant, the item stays visible even when findings
 * fall to zero (so the "clean" signal earns its keep).
 *
 * The relevance state RELEASES when the user removes the last CI
 * folder from a multi-root workspace — otherwise the item would stay
 * pinned with "clean" for the rest of the session even though the
 * workspace no longer has anything to scan. The release is gated on
 * a fresh `findFiles` sweep so a momentary "no current findings" state
 * (e.g. an in-flight rebuild) doesn't accidentally hide the item.
 */
export function registerStatusBar(
  context: vscode.ExtensionContext,
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  item.command = "pipelineCheck.findings.focus";
  item.name = "Pipeline-Check";

  // Latches when we observe evidence of CI relevance, releases when
  // the workspace stops having any. The release path is the only
  // reason this isn't a one-way latch.
  let relevant = false;

  const update = () => {
    const counts = countDiagnostics(vscode.languages.getDiagnostics());
    item.text = formatStatusBarText(counts);
    item.tooltip = formatStatusBarTooltip(counts);
    item.accessibilityInformation = {
      label: formatStatusBarAccessibilityLabel(counts),
    };
    item.backgroundColor = pickBackgroundColor(counts);
    const total =
      counts.CRITICAL + counts.HIGH + counts.MEDIUM + counts.LOW + counts.INFO;
    if (total > 0) relevant = true;
    if (relevant) {
      item.show();
    } else {
      item.hide();
    }
  };

  /**
   * Re-evaluate workspace relevance by sweeping for any CI file under
   * the current folders. Sets `relevant` accordingly and refreshes
   * the item. Used at activation and again every time the user
   * adds/removes a workspace folder.
   */
  const recheckRelevance = () => {
    void vscode.workspace
      .findFiles(WORKSPACE_HAS_CI_GLOB, "**/{node_modules,.git}/**", 1)
      .then((uris) => {
        if (uris.length > 0) {
          relevant = true;
        } else {
          // No candidate files anywhere in the workspace. If we
          // ALSO have no current diagnostics, the item should go
          // back to hidden — the workspace has nothing to do with
          // Pipeline-Check right now. The diagnostic check inside
          // `update()` will re-latch immediately if a publish lands.
          const counts = countDiagnostics(vscode.languages.getDiagnostics());
          const total =
            counts.CRITICAL +
            counts.HIGH +
            counts.MEDIUM +
            counts.LOW +
            counts.INFO;
          if (total === 0) {
            relevant = false;
          }
        }
        update();
      });
  };

  recheckRelevance();
  update();
  context.subscriptions.push(
    item,
    vscode.languages.onDidChangeDiagnostics(update),
    // Re-sweep whenever the workspace shape changes — the user added
    // or removed a folder via the Workspaces UI. Without this, removing
    // the only CI folder would leave the status bar pinned to "clean"
    // for the rest of the session.
    vscode.workspace.onDidChangeWorkspaceFolders(recheckRelevance),
  );

  return item;
}
