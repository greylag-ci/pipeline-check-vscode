// Title-bar Quick Pick handlers for the Findings panel. Lived inline
// in extension.ts through v1.1.0 development; extracted here so the
// behavior (active-mode check-mark, user-cancelled is a no-op,
// canPickMany toggle semantics) can be unit-tested without booting an
// extension host. extension.ts wires them up at command-registration
// time.
//
// The `showQuickPick` parameter is injectable so tests pass a fake
// without needing to mock the `vscode` module globally. Production
// callers omit it and get `vscode.window.showQuickPick` via the
// default.

import * as vscode from "vscode";

import {
  FindingsTreeProvider,
  GroupMode,
  SEVERITY_ORDER,
  type SeverityName,
} from "./findingsView";

// Group-mode options offered by the Findings panel's "Change Grouping"
// button. Labels are user-facing; descriptions are the muted secondary
// text in the Quick Pick row. The order matches the title-bar history
// of the radio buttons that this Quick Pick replaces, so muscle
// memory carries over.
export const GROUPING_PICKS: readonly {
  readonly mode: GroupMode;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    mode: "severity",
    label: "Severity",
    description: "Critical, High, Medium, Low, Info",
  },
  {
    mode: "file",
    label: "File",
    description: "One bucket per file, ordered by path",
  },
  {
    mode: "rule",
    label: "Rule",
    description: "One bucket per check ID (GHA-001, etc.)",
  },
];

// One-line description per severity for the Quick Pick rows. Kept
// alongside the command rather than on the SeverityName type because
// the copy is title-bar-UX rather than a property of the severity.
export const SEVERITY_PICK_DESCRIPTION: Record<SeverityName, string> = {
  CRITICAL: "Exploitable now; ship-blocking",
  HIGH: "Likely exploit path; fix this sprint",
  MEDIUM: "Hardening or defense-in-depth",
  LOW: "Hygiene / best-practice",
  INFO: "Informational; no action required",
};

/**
 * Minimal shape of `vscode.window.showQuickPick` the handlers need.
 * The real signature is overloaded with a generic on the item type;
 * we collapse it to `QuickPickItem` here so the injected fake doesn't
 * have to satisfy the generic-variance dance. Each handler narrows
 * the returned value back to its own pick shape via a cast — the
 * runtime contract is the same.
 */
export type ShowQuickPick = (
  items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>,
  options?: vscode.QuickPickOptions,
) => Thenable<vscode.QuickPickItem | vscode.QuickPickItem[] | undefined>;

/**
 * Single-select Quick Pick for the Findings-panel grouping mode.
 * Shows the current mode prefixed with $(check); selecting a different
 * row flips the provider's group mode. Cancelling leaves the current
 * selection unchanged.
 *
 * `showQuickPick` injectable so tests can pass a fake without mocking
 * the vscode module globally. Production calls land on
 * `vscode.window.showQuickPick` via the default.
 */
export async function changeGrouping(
  provider: FindingsTreeProvider,
  showQuickPick: ShowQuickPick = vscode.window.showQuickPick as ShowQuickPick,
): Promise<void> {
  const current = provider.getGroupMode();
  type Pick = vscode.QuickPickItem & { mode: GroupMode };
  const items: Pick[] = GROUPING_PICKS.map((p) => ({
    // ``$(check)`` prefix marks the active mode. The Quick Pick has
    // no native "selected option" affordance for show-only-callback
    // pickers, so we draw the check ourselves — same pattern VS Code
    // uses for its "Change Language Mode" picker.
    label: p.mode === current ? `$(check) ${p.label}` : `    ${p.label}`,
    description: p.description,
    mode: p.mode,
  }));
  const choice = (await showQuickPick(items, {
    title: "Group findings by",
    placeHolder: "Choose how the panel should bucket findings",
  })) as Pick | undefined;
  if (choice) {
    provider.setGroupMode(choice.mode);
  }
}

/**
 * Multi-select Quick Pick that lets the user choose which severities
 * appear in the Findings panel. Editor-surface diagnostics (gutter,
 * Problems panel) keep showing everything that clears
 * `severityThreshold` — this filter is panel-only, so a user can mute
 * MEDIUM in the panel while triaging CRITICAL without changing the
 * settings that propagate to the rest of the editor.
 *
 * Items default to `picked: true` for the severities currently
 * visible; the user unchecks the ones they want to hide. Cancelling
 * the picker leaves the previous selection untouched.
 */
export async function toggleSeverity(
  provider: FindingsTreeProvider,
  showQuickPick: ShowQuickPick = vscode.window.showQuickPick as ShowQuickPick,
): Promise<void> {
  const hidden = provider.getHiddenSeverities();
  type Pick = vscode.QuickPickItem & { severity: SeverityName };
  const items: Pick[] = SEVERITY_ORDER.map((sev) => ({
    label: sev,
    description: SEVERITY_PICK_DESCRIPTION[sev],
    severity: sev,
    picked: !hidden.has(sev),
  }));
  const chosen = (await showQuickPick(items, {
    canPickMany: true,
    title: "Show severities in the Findings panel",
    placeHolder:
      "Uncheck a severity to hide it from the panel (editor surface unchanged)",
  })) as Pick[] | undefined;
  if (!chosen) return; // user cancelled — leave the current selection alone
  const visibleSet = new Set(chosen.map((c) => c.severity));
  const nextHidden = new Set<SeverityName>();
  for (const sev of SEVERITY_ORDER) {
    if (!visibleSet.has(sev)) nextHidden.add(sev);
  }
  provider.setHiddenSeverities(nextHidden);
}
