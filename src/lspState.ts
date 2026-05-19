// Drives the `when` clauses on the two `viewsWelcome` entries in
// package.json — an install-prompt panel before the LSP comes up, a
// "Scan workspace" panel once it is connected. Pulled out of
// extension.ts so the state flip can be exercised in isolation by the
// unit suite.

import * as vscode from "vscode";

export const LSP_READY_CONTEXT_KEY = "pipelineCheck.lspReady";

// Module-level mirror of what we last pushed to the VS Code context
// key. setContext is fire-and-forget and there is no synchronous
// reader for context keys, so anything that needs to gate behavior on
// LSP readiness (e.g. the scan-workspace command) reads through
// isLspReady() instead. Kept in lockstep with setContext below — a
// missed update here means both the welcome panel and the gate
// disagree, which is worse than either alone.
let ready = false;

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
export function setLspReady(value: boolean): void {
  ready = value;
  void vscode.commands.executeCommand(
    "setContext",
    LSP_READY_CONTEXT_KEY,
    value,
  );
}

/**
 * Synchronous readback for code paths that must decide whether the
 * LSP is alive RIGHT NOW (e.g. scan-workspace, which would otherwise
 * happily open every candidate document against a dead server and
 * report "scanned N files" with no findings). The welcome panel
 * still reads off the VS Code context key — this is for code that
 * runs outside a `when:` clause.
 */
export function isLspReady(): boolean {
  return ready;
}
