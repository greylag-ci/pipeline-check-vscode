// LSP install helpers, factored out of extension.ts so the welcome-
// panel CTAs and the LSP-failure toast share one implementation — and
// so the behaviour is unit-testable without booting an extension host.

import * as vscode from "vscode";

export const PIP_INSTALL_COMMAND = 'pip install "pipeline-check[lsp]"';

const TERMINAL_NAME = "Pipeline-Check install";
const CONFIRM_TTL_MS = 2500;

/**
 * Open the integrated terminal, type the pip install command, and
 * focus the terminal — but do NOT press Enter. The user reviews the
 * command (and activates their conda env / venv first when relevant)
 * before running it. Auto-running here would install into whatever
 * Python the shell's default `pip` points at — usually wrong when the
 * user has a project venv they haven't activated yet.
 *
 * Reuses any existing "Pipeline-Check install" terminal that is still
 * alive (`exitStatus === undefined`) so repeated clicks on the
 * welcome-panel CTA don't stack identical terminals in the dropdown.
 * A terminal the user already closed (exitStatus is set) is treated
 * as dead and a fresh one takes its place.
 *
 * Pulled out as a module-level function (rather than an extension-
 * internal closure) so the welcome-panel command, the LSP-failure
 * toast, and the test suite all hit the same code path.
 */
export function installInTerminal(): vscode.Terminal {
  const existing = vscode.window.terminals.find(
    (t) => t.name === TERMINAL_NAME && t.exitStatus === undefined,
  );
  const terminal = existing ?? vscode.window.createTerminal(TERMINAL_NAME);
  terminal.show();
  // The second argument to sendText is `addNewLine`; passing `false`
  // suppresses the Enter press, which is the whole point.
  terminal.sendText(PIP_INSTALL_COMMAND, false);
  return terminal;
}

/**
 * Copy the pip install command to the clipboard and surface a short
 * status-bar confirmation. Kept around as a fallback for headless
 * flows where opening a terminal would be wrong.
 */
export async function copyInstallCommandToClipboard(): Promise<void> {
  await vscode.env.clipboard.writeText(PIP_INSTALL_COMMAND);
  vscode.window.setStatusBarMessage(
    `Copied: ${PIP_INSTALL_COMMAND}`,
    CONFIRM_TTL_MS,
  );
}
