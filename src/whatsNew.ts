// "What's new in this version" one-time notification. Fires the first
// time the user activates a freshly-installed major/minor upgrade so
// they can find out the new surfaces (Findings panel, status bar,
// CodeLens, Alt+F8 nav, etc.) without reading the CHANGELOG.
//
// The check compares the running `extension.packageJSON.version`
// against the value stashed in `context.globalState` from the prior
// activation. On a first install or after a real upgrade, the values
// differ and the notification fires; otherwise it's silent. Patch
// bumps (0.2.0 → 0.2.1) also trigger because patches sometimes fix
// user-visible bugs; if the noise turns out to be excessive we can
// gate to minor / major bumps only.

import * as vscode from "vscode";

const STATE_KEY = "pipelineCheck.lastSeenVersion";

/**
 * Compare two semver strings — returns true if `next` is later than
 * `prev`, false otherwise (including equal). Tolerates undefined /
 * malformed prev (treated as "older than anything"). Strips
 * pre-release suffixes (`-rc.1`) to keep the comparison about the
 * semver core.
 */
export function isUpgrade(prev: string | undefined, next: string): boolean {
  if (!prev) return true;
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split("-")[0]
      .split(".")
      .map((s) => parseInt(s, 10) || 0);
  const a = parse(prev);
  const b = parse(next);
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (bv > av) return true;
    if (bv < av) return false;
  }
  return false;
}

/**
 * Build the notification message. Exported for unit testing; the
 * `version` is whatever the manifest reports at activation time.
 */
export function composeMessage(version: string): string {
  return `Pipeline-Check ${version} is here. The Findings panel, status bar item, inline CodeLens, and Alt+F8 navigation are new — see what changed?`;
}

/**
 * Surface the upgrade notification asynchronously. Returns the chosen
 * action (or undefined when there's nothing to show / the user
 * dismissed). The function never throws on missing globalState — a
 * fresh extension host with no state still gets the first-install
 * notification.
 */
export async function showWhatsNewIfUpgraded(
  context: vscode.ExtensionContext,
  manifestVersion: string,
  options: {
    /** Override the default "open release notes" target. Tests pass a noop. */
    openExternal?: (url: string) => Thenable<boolean>;
  } = {},
): Promise<string | undefined> {
  const prev = context.globalState.get<string>(STATE_KEY);
  if (!isUpgrade(prev, manifestVersion)) {
    return undefined;
  }
  // Persist the new version first so a notification that gets ignored
  // (user clicks elsewhere, VS Code closes) still doesn't repeat next
  // session. The cost of "user missed the notification once" is lower
  // than the cost of "user sees it every launch until they engage".
  await context.globalState.update(STATE_KEY, manifestVersion);

  const SEE_RELEASE = "See release notes";
  const DISMISS = "Got it";
  const choice = await vscode.window.showInformationMessage(
    composeMessage(manifestVersion),
    SEE_RELEASE,
    DISMISS,
  );
  if (choice === SEE_RELEASE) {
    const url = `https://github.com/greylag-ci/pipeline-check-vscode/releases/tag/v${manifestVersion}`;
    const open = options.openExternal ?? ((u) => vscode.env.openExternal(vscode.Uri.parse(u)));
    await open(url);
  }
  return choice;
}
