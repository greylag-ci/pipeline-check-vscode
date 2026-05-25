// Lightbulb-driving CodeActionProvider for Pipeline-Check diagnostics.
// The "real" suppress-this-finding action is blocked on the upstream
// CLI publishing a suppression-comment syntax (roadmap R11), but the
// rule-agnostic ergonomics actions below don't depend on that: they
// work for every diagnostic the server publishes today.
//
// Three actions, in priority order:
//
//   1. Open <ruleId> documentation
//      Surfaces only when the server published `Diagnostic.code.target`.
//      Same destination as the Findings tree's leaf "Open Rule
//      Documentation" context entry — but reachable from the editor
//      without round-tripping through the panel.
//
//   2. Copy rule ID (<ruleId>)
//      For pasting into a ticket, suppression file, or PR comment.
//      Same code path as `pipelineCheck.findings.copyRuleId`.
//
//   3. Show in Pipeline-Check Findings panel
//      Always available. Focuses the activity-bar container so the
//      user can flip to "what else is going on in this workspace?"
//      with one click. Falls back to revealing the panel even when
//      the diagnostic has no rule ID or docs URL.
//
// We intentionally do NOT mark any of these as `isPreferred` — none
// of them mutate the file, so VS Code's auto-apply-on-Enter machinery
// would surprise users. They show as quick-fix bulbs alongside fixes
// from other extensions.

import * as vscode from "vscode";

const DIAGNOSTIC_SOURCE = "pipeline-check";

// Built-in command that focuses an activity-bar view container by id.
// Matches the `id` field in package.json's `viewsContainers.activitybar`
// entry. Kept as a constant so a future rename of the container is a
// one-line change.
const FOCUS_FINDINGS_PANEL_COMMAND = "workbench.view.extension.pipelineCheck";

export class PipelineCheckCodeActionProvider
  implements vscode.CodeActionProvider
{
  // Declared `static` so the manifest registration in extension.ts can
  // hand the same list to `registerCodeActionsProvider` without having
  // to instantiate the provider just to read the supported kinds.
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    _document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diag of context.diagnostics) {
      if (diag.source !== DIAGNOSTIC_SOURCE) continue;
      const ruleId = readRuleId(diag);
      const docsUrl = readDocsUrl(diag);

      if (docsUrl) {
        const open = new vscode.CodeAction(
          ruleId
            ? `Open ${ruleId} documentation`
            : "Open rule documentation",
          vscode.CodeActionKind.QuickFix,
        );
        open.command = {
          command: "vscode.open",
          title: "Open rule documentation",
          arguments: [vscode.Uri.parse(docsUrl)],
        };
        open.diagnostics = [diag];
        actions.push(open);
      }

      if (ruleId) {
        const copy = new vscode.CodeAction(
          `Copy rule ID (${ruleId})`,
          vscode.CodeActionKind.QuickFix,
        );
        // Reuse the same command the Findings-panel context menu fires
        // by handing it a synthetic leaf-shaped argument. Keeps the
        // copy + status-bar-confirm behaviour in one place.
        copy.command = {
          command: "pipelineCheck.findings.copyRuleId",
          title: "Copy rule ID",
          arguments: [{ finding: { ruleId } }],
        };
        copy.diagnostics = [diag];
        actions.push(copy);
      }

      // Always show the panel-reveal action so even an empty
      // diagnostic (no ruleId, no docsUrl) carries SOME bulb. The
      // panel-context jump answers "where else does this rule fire
      // in my workspace?" — most useful when the user wants to
      // triage a batch.
      const reveal = new vscode.CodeAction(
        "Show in Pipeline-Check Findings panel",
        vscode.CodeActionKind.QuickFix,
      );
      reveal.command = {
        command: FOCUS_FINDINGS_PANEL_COMMAND,
        title: "Show Findings panel",
      };
      reveal.diagnostics = [diag];
      actions.push(reveal);
    }
    return actions;
  }
}

function readRuleId(diag: vscode.Diagnostic): string {
  // ``Diagnostic.code`` shapes — string, number, or
  // ``{ value, target }`` — match what findingsView.ts already handles.
  // The duplication is 6 lines per file; extracting them would mean a
  // new module for two getters, which is more cost than benefit today.
  if (typeof diag.code === "string") return diag.code;
  if (typeof diag.code === "number") return String(diag.code);
  if (diag.code && typeof diag.code === "object") return String(diag.code.value);
  return "";
}

function readDocsUrl(diag: vscode.Diagnostic): string | undefined {
  if (
    diag.code &&
    typeof diag.code === "object" &&
    "target" in diag.code &&
    diag.code.target
  ) {
    // `target` is typed as `vscode.Uri` but VS Code receives publish
    // payloads from the LSP unchanged, so a malformed `target` (a
    // proxy whose toString throws, a getter that crashes) can reach
    // us. A throw here would propagate up into VS Code's lightbulb
    // plumbing and silently disable lightbulbs for the file. Swallow
    // the crash and treat the URL as absent — the lightbulb still
    // shows the Copy and Reveal actions on the same diagnostic.
    try {
      return diag.code.target.toString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}
