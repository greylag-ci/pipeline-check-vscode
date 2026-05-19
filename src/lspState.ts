// Drives the `when` clauses on the two `viewsWelcome` entries in
// package.json — an install-prompt panel before the LSP comes up, a
// "Scan workspace" panel once it is connected. Pulled out of
// extension.ts so the state flip can be exercised in isolation by the
// unit suite.

import * as vscode from "vscode";

export const LSP_READY_CONTEXT_KEY = "pipelineCheck.lspReady";

/**
 * Set the `pipelineCheck.lspReady` context key. The two viewsWelcome
 * entries — install-prompt vs scan-workspace — read from this key, so
 * flipping it is the only signal the welcome panel needs to swap.
 *
 * Detached on purpose: `setContext` returns a Thenable, but every
 * caller fires this as a side effect that the caller does not await.
 * Using `void` keeps the call non-blocking without losing the
 * returned promise's rejection handling (VS Code's setContext does
 * not reject in practice).
 */
export function setLspReady(ready: boolean): void {
  void vscode.commands.executeCommand(
    "setContext",
    LSP_READY_CONTEXT_KEY,
    ready,
  );
}
