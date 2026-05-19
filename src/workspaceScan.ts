// Workspace-wide scan, surfaced as the `pipelineCheck.scanWorkspace`
// command. The LSP server analyzes files on `didOpen`, so a "scan
// everything" boils down to enumerating the candidate file set and
// loading each document. The Findings panel reads from the diagnostic
// stream the server publishes back, so the tree fills in as each scan
// completes — no separate state to manage, and no extra serializer to
// keep in sync with the upstream CLI's JSON output.
//
// The candidate patterns come from providers.ts so the
// documentSelector, activationEvents, and this scan stay in lockstep
// (R14 — single source of truth).

import * as vscode from "vscode";

import { TRIGGER_PATTERNS } from "./providers";

// Common heavy directories that should never carry a real workflow file
// (we still match `.github/workflows/*` if it lives under one, but
// dependency caches and build artefacts cost us nothing to skip).
const EXCLUDE_GLOB =
  "**/{node_modules,.git,dist,out,target,build,.venv,venv,.tox,.cache}/**";

/** Combine the candidate patterns into a single brace-glob VS Code accepts. */
export function buildScanGlob(
  patterns: readonly string[] = TRIGGER_PATTERNS,
): string {
  return `{${patterns.join(",")}}`;
}

export interface ScanResult {
  readonly scanned: number;
  readonly failed: number;
  readonly cancelled: boolean;
}

/**
 * Walk the workspace, open every candidate document, and let the LSP's
 * `didOpen` pipeline produce diagnostics. Returns a summary the caller
 * surfaces via a toast.
 *
 * Files that fail to load (read errors, unsupported encodings) are
 * counted but never abort the scan — one bad file shouldn't hide
 * findings in the other 49.
 */
export async function scanWorkspace(): Promise<ScanResult> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showInformationMessage(
      "Pipeline-Check: open a workspace folder before scanning.",
    );
    return { scanned: 0, failed: 0, cancelled: false };
  }

  const uris = await vscode.workspace.findFiles(buildScanGlob(), EXCLUDE_GLOB);

  if (uris.length === 0) {
    void vscode.window.showInformationMessage(
      "Pipeline-Check: no scannable files found in this workspace.",
    );
    return { scanned: 0, failed: 0, cancelled: false };
  }

  let scanned = 0;
  let failed = 0;
  let cancelled = false;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Pipeline-Check: scanning workspace",
      cancellable: true,
    },
    async (progress, token) => {
      const step = 100 / uris.length;
      for (const uri of uris) {
        if (token.isCancellationRequested) {
          cancelled = true;
          break;
        }
        progress.report({
          message: `${scanned + failed + 1}/${uris.length} · ${vscode.workspace.asRelativePath(uri)}`,
          increment: step,
        });
        try {
          // Loading the document drives the LSP's `didOpen`. The
          // server picks up the file, publishes diagnostics, and the
          // Findings panel re-renders from the diagnostic stream.
          // openTextDocument does not steal editor focus — it only
          // makes the document part of `workspace.textDocuments`.
          await vscode.workspace.openTextDocument(uri);
          scanned += 1;
        } catch {
          failed += 1;
        }
      }
    },
  );

  const summary = formatSummary({ scanned, failed, cancelled });
  if (cancelled || failed > 0) {
    void vscode.window.showWarningMessage(summary);
  } else {
    void vscode.window.showInformationMessage(summary);
  }
  return { scanned, failed, cancelled };
}

/** Human-readable summary of a scan run. Exported for unit testing. */
export function formatSummary(r: ScanResult): string {
  const file = (n: number) => `${n} file${n === 1 ? "" : "s"}`;
  if (r.cancelled) {
    return `Pipeline-Check: scan cancelled after ${file(r.scanned)} (${r.failed} failed).`;
  }
  if (r.failed > 0) {
    return `Pipeline-Check: scanned ${file(r.scanned)} (${r.failed} failed).`;
  }
  return `Pipeline-Check: scanned ${file(r.scanned)}.`;
}
