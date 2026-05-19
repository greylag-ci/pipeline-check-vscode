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

import { isLspReady } from "./lspState";
import { TRIGGER_PATTERNS } from "./providers";

// Common heavy directories that should never carry a real workflow file
// (we still match `.github/workflows/*` if it lives under one, but
// dependency caches and build artefacts cost us nothing to skip).
const EXCLUDE_GLOB =
  "**/{node_modules,.git,dist,out,target,build,.venv,venv,.tox,.cache}/**";

// Run `findFiles` once per pattern and union the results. VS Code's glob
// parser does not reliably handle nested brace alternations, so a single
// combined glob like `{**/.github/workflows/*.{yml,yaml},**/.gitlab-ci.yml,…}`
// silently matches nothing — the symptom reported as "no scannable files
// found" even when workflows are present. One findFiles per pattern keeps
// each glob shallow (at most one brace level for `.{yml,yaml}`) and the
// result is deduped on the URI string.
//
// Exported so the unit suite can pin the "one findFiles call per
// pattern, deduped on URI string" contract that prevents a future
// re-introduction of the nested-brace bug.
export async function findScannableFiles(
  patterns: readonly string[],
  exclude: string,
): Promise<vscode.Uri[]> {
  const seen = new Set<string>();
  const out: vscode.Uri[] = [];
  const batches = await Promise.all(
    patterns.map((p) => vscode.workspace.findFiles(p, exclude)),
  );
  for (const batch of batches) {
    for (const uri of batch) {
      const key = uri.toString();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(uri);
      }
    }
  }
  return out;
}

export interface ScanResult {
  readonly scanned: number;
  readonly failed: number;
  readonly cancelled: boolean;
  /**
   * True when this call returned without doing any work because a
   * previous scan was still in flight. Lets callers distinguish a
   * "nothing to do" result from a "deferred to in-flight scan"
   * result. Defaults to false (we did the work).
   */
  readonly skippedAsBusy?: boolean;
}

export interface ScanOptions {
  /**
   * Quiet scans render as a status-bar progress item (no modal toast)
   * and suppress the completion notification. Used by the scan-on-save
   * path so a save-heavy workflow doesn't paper the screen with toasts.
   * The user-initiated scan command still uses the notification surface
   * — discoverable progress + a cancellation button.
   */
  readonly quiet?: boolean;
}

// Module-level in-flight guard shared by every scanWorkspace caller.
// The scan-on-save path used to carry its own local flag; the
// user-initiated `Pipeline-Check: Scan workspace` command had none, so
// double-clicking the button (or scan + refresh) yielded two concurrent
// progress notifications iterating the same URI list. One flag here
// covers every entrypoint without each call site having to remember.
// Exported through `isScanInProgress` for tests; not a configurable knob.
let scanInProgress = false;

/** Snapshot of the in-flight flag, for tests. Not for runtime callers. */
export function isScanInProgress(): boolean {
  return scanInProgress;
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
export async function scanWorkspace(
  options: ScanOptions = {},
): Promise<ScanResult> {
  const quiet = options.quiet === true;

  // Single-flight guard. A noisy double-fire (scan + refresh in
  // quick succession, or rapid clicks on the title-bar button) used
  // to spawn two progress notifications and two openTextDocument
  // walks against the same URI list. The second caller now bails
  // immediately and surfaces a friendly "scan already in progress"
  // toast (in noisy mode) so the user knows the click was honored.
  if (scanInProgress) {
    if (!quiet) {
      void vscode.window.showInformationMessage(
        "Pipeline-Check: a workspace scan is already in progress.",
      );
    }
    return { scanned: 0, failed: 0, cancelled: false, skippedAsBusy: true };
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    if (!quiet) {
      void vscode.window.showInformationMessage(
        "Pipeline-Check: open a workspace folder before scanning.",
      );
    }
    return { scanned: 0, failed: 0, cancelled: false };
  }

  // Without a live LSP the scan would `openTextDocument` every
  // candidate file and then... nothing — no didOpen recipient, no
  // diagnostics published, no Findings update. The completion toast
  // would still claim "scanned N files", which is a worse signal than
  // a clear "LSP isn't running" cue with an actionable button. Skip
  // the scan in that case and route the user toward the install /
  // restart path.
  if (!isLspReady()) {
    if (!quiet) {
      void vscode.window
        .showWarningMessage(
          "Pipeline-Check: language server is not running. Install it (or restart) before scanning.",
          "Install in terminal",
          "Restart language server",
          "Open server log",
        )
        .then((choice) => {
          if (choice === "Install in terminal") {
            void vscode.commands.executeCommand(
              "pipelineCheck.installInTerminal",
            );
          } else if (choice === "Restart language server") {
            void vscode.commands.executeCommand("pipelineCheck.restart");
          } else if (choice === "Open server log") {
            void vscode.commands.executeCommand("pipelineCheck.showLog");
          }
        });
    }
    return { scanned: 0, failed: 0, cancelled: false };
  }

  // Latch the in-flight guard BEFORE the first await. Setting it later
  // (e.g. after findScannableFiles resolves) opens a tiny window where
  // two concurrent calls both pass the `if (scanInProgress) bail` check
  // before either sets the flag, defeating the single-flight contract.
  // The synchronous precondition bails above (no folders, LSP not
  // ready) return without locking, since they did no real work; the
  // "no scannable files" branch below sits INSIDE the try/finally, so
  // findFiles enumeration counts as work and is single-flighted.
  scanInProgress = true;
  let scanned = 0;
  let failed = 0;
  let cancelled = false;
  try {
    const uris = await findScannableFiles(TRIGGER_PATTERNS, EXCLUDE_GLOB);

    if (uris.length === 0) {
      if (!quiet) {
        void vscode.window.showInformationMessage(
          "Pipeline-Check: no scannable files found in this workspace.",
        );
      }
      return { scanned: 0, failed: 0, cancelled: false };
    }

    await vscode.window.withProgress(
      {
        // Status-bar spinner in quiet mode, full modal progress for the
        // user-initiated command. The status-bar surface has no inherent
        // cancellation affordance, so we drop `cancellable` too — a
        // quiet scan-on-save scan is short-lived enough that not having a
        // cancel button isn't a regression in practice.
        location: quiet
          ? vscode.ProgressLocation.Window
          : vscode.ProgressLocation.Notification,
        title: "Pipeline-Check: scanning workspace",
        cancellable: !quiet,
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
  } finally {
    // Release the in-flight guard on every exit path including a
    // thrown progress task or a thrown findScannableFiles —
    // otherwise a single crash would block every subsequent scan
    // until the extension host reloads.
    scanInProgress = false;
  }

  if (!quiet) {
    const summary = formatSummary({ scanned, failed, cancelled });
    if (cancelled || failed > 0) {
      void vscode.window.showWarningMessage(summary);
    } else {
      void vscode.window.showInformationMessage(summary);
    }
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
