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
 * malformed prev (treated as "older than anything").
 *
 * Pre-release semantics (per semver §11): a pre-release version is
 * LOWER precedence than the corresponding release. So
 * `1.0.0-rc.1` < `1.0.0`. Without this distinction, a user who ran
 * `1.0.0-rc.1` would never see the "What's New" toast for the
 * actual `1.0.0` GA — both core triples are equal, and a naive
 * triple-only compare would return false. The toast skipping the
 * GA is the worst possible time to skip it.
 */
export function isUpgrade(prev: string | undefined, next: string): boolean {
  if (!prev) return true;
  const parsed = (v: string) => {
    const stripped = v.replace(/^v/, "");
    const [core, pre] = stripped.split("-", 2);
    return {
      triple: core.split(".").map((s) => parseInt(s, 10) || 0),
      // Empty string is a normal release; any non-empty suffix is a
      // pre-release (rc.N, alpha.N, beta.N, etc.).
      prerelease: pre ?? "",
    };
  };
  const a = parsed(prev);
  const b = parsed(next);
  for (let i = 0; i < 3; i++) {
    const av = a.triple[i] ?? 0;
    const bv = b.triple[i] ?? 0;
    if (bv > av) return true;
    if (bv < av) return false;
  }
  // Same core triple. Resolve via pre-release per semver §11:
  //   - prev has pre-release, next does not   → upgrade (rc → ga)
  //   - prev no pre-release, next has one     → not an upgrade (ga → rc)
  //   - both have pre-release  → per-identifier compare (§11.4):
  //                              numeric identifiers compare numerically
  //                              (so `rc.10` > `rc.2`), non-numeric ones
  //                              lexically, numeric < non-numeric, and a
  //                              longer set wins when all preceding match.
  //   - both same / both empty → equal, not an upgrade
  if (a.prerelease && !b.prerelease) return true;
  if (!a.prerelease && b.prerelease) return false;
  return comparePrerelease(a.prerelease, b.prerelease) < 0;
}

/**
 * Per-identifier pre-release compare per semver §11.4. Returns a
 * negative number when `a < b`, a positive number when `a > b`, and
 * zero when they're equal. Exported for unit testing.
 *
 * The previous implementation used a bare `>` on the suffix string,
 * which fails on numeric identifiers with mixed widths — `"rc.10"`
 * compares LESS than `"rc.2"` in ASCII order because `'1' < '2'`. The
 * spec is explicit: digit-only identifiers compare numerically.
 */
export function comparePrerelease(a: string, b: string): number {
  if (a === b) return 0;
  const aIds = a.split(".");
  const bIds = b.split(".");
  const len = Math.max(aIds.length, bIds.length);
  for (let i = 0; i < len; i++) {
    const ai = aIds[i];
    const bi = bIds[i];
    // A longer set of identifiers wins when all preceding match
    // (§11.4.4). Missing identifier on either side ranks lower.
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const an = parseInt(ai, 10);
      const bn = parseInt(bi, 10);
      if (an !== bn) return an - bn;
    } else if (aNum !== bNum) {
      // Numeric identifiers always have lower precedence than
      // non-numeric ones (§11.4.3).
      return aNum ? -1 : 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Build the notification message. Exported for unit testing; the
 * `version` is whatever the manifest reports at activation time.
 *
 * Intentionally generic — the toast fires on every minor / patch
 * bump and a per-release feature list would be stale immediately
 * after the next bump. The "See release notes" action on the toast
 * routes the user to the version-specific CHANGELOG entry, which is
 * always current.
 */
export function composeMessage(version: string): string {
  return `Pipeline-Check ${version} is here. See what changed?`;
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
