// File-level CodeLens summarising Pipeline-Check findings at the top
// of each scanned document. Pinned to line 1 so it's visible the
// moment the file opens — same surface that test runners use for
// "Run | Debug" above a test function.
//
// Reads strictly from already-published diagnostics (the LSP's
// stream); never triggers its own scan. The lens command opens the
// Findings panel so the user can drill in.
//
// `summariseCounts` and the lens-text composer are exported as pure
// functions so the test suite can pin the copy without booting the
// editor.

import * as vscode from "vscode";

const DIAGNOSTIC_SOURCE = "pipeline-check";

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
type SeverityName = (typeof SEVERITY_ORDER)[number];

export interface SeverityCounts {
  readonly CRITICAL: number;
  readonly HIGH: number;
  readonly MEDIUM: number;
  readonly LOW: number;
  readonly INFO: number;
}

/**
 * Tally the per-severity counts of pipeline-check diagnostics in
 * `diags`. Falls back to INFO for missing or unknown severity names,
 * matching the policy in findingsView.ts.
 */
export function summariseCounts(
  diags: readonly vscode.Diagnostic[],
): SeverityCounts {
  const counts: { -readonly [K in SeverityName]: number } = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };
  for (const d of diags) {
    if (d.source !== DIAGNOSTIC_SOURCE) continue;
    counts[readSeverity(d)] += 1;
  }
  return counts;
}

function readSeverity(diag: vscode.Diagnostic): SeverityName {
  const data = (diag as vscode.Diagnostic & {
    data?: { severity?: string };
  }).data;
  const name = (data?.severity ?? "").toUpperCase();
  return (SEVERITY_ORDER as readonly string[]).includes(name)
    ? (name as SeverityName)
    : "INFO";
}

/**
 * Render the lens title from per-severity counts. Examples:
 *
 *   { CRITICAL: 2 }                → "Pipeline-Check: 2 critical"
 *   { CRITICAL: 2, HIGH: 1 }       → "Pipeline-Check: 2 critical · 1 high"
 *   { LOW: 5 }                     → "Pipeline-Check: 5 low"
 *   {}                             → null  (caller omits the lens)
 *
 * Lists only nonzero buckets in severity order so the lens text reads
 * top-to-bottom like the Findings tree.
 */
export function composeLensTitle(c: SeverityCounts): string | null {
  const parts: string[] = [];
  for (const sev of SEVERITY_ORDER) {
    if (c[sev] > 0) {
      parts.push(`${c[sev]} ${sev.toLowerCase()}`);
    }
  }
  if (parts.length === 0) return null;
  return `Pipeline-Check: ${parts.join(" · ")}`;
}

/**
 * CodeLens provider for scanned-document file-level summaries. The
 * lens sits at the top of the file (line 0, col 0) and clicking it
 * reveals the Findings panel.
 *
 * Re-emits on every onDidChangeDiagnostics so the lens text tracks
 * the latest LSP publish. The vscode runtime debounces lens fetches,
 * so we don't have to worry about thrash.
 */
export class FindingsCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.languages.onDidChangeDiagnostics(() =>
        this._onDidChangeCodeLenses.fire(),
      ),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const counts = summariseCounts(
      vscode.languages.getDiagnostics(document.uri),
    );
    const title = composeLensTitle(counts);
    if (!title) return [];
    return [
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title,
        command: "pipelineCheck.findings.focus",
      }),
    ];
  }
}
