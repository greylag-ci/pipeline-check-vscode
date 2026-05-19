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
  return lines.join("\n");
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
 * Wire up the status bar item. Returns a Disposable the caller pushes
 * onto the extension's subscriptions so the item is removed on
 * deactivate. The item itself rewires on every diagnostic change and
 * navigates to the Findings panel on click.
 */
export function registerStatusBar(
  context: vscode.ExtensionContext,
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  // Click reveals the Findings panel; same action as the activity-bar
  // icon, just from a different surface.
  item.command = "pipelineCheck.findings.focus";
  item.name = "Pipeline-Check";

  const update = () => {
    const counts = countDiagnostics(vscode.languages.getDiagnostics());
    item.text = formatStatusBarText(counts);
    item.tooltip = formatStatusBarTooltip(counts);
    item.show();
  };

  // Seed and subscribe.
  update();
  context.subscriptions.push(
    item,
    vscode.languages.onDidChangeDiagnostics(update),
  );

  return item;
}
