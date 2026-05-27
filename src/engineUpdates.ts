// Daily PyPI poll for a newer `pipeline-check` engine. Fires a
// non-blocking notification when the latest release on PyPI is newer
// than the engine version the preflight just captured. The
// notification's primary action runs the existing `upgradeInTerminal`
// flow — terminal opens, command typed, user reviews and presses
// Enter. The extension never runs pip itself; the "no silent pip
// mutations against the wrong interpreter" invariant from
// [src/install.ts] holds here too.
//
// This is independent of the hard `MIN_ENGINE_VERSION` floor in
// [src/preflight.ts]: that floor drives the preflight's
// `out_of_date` rejection (and the welcome-panel Upgrade entry) when
// the user's engine is too old to support the extension's features.
// The check below is the opposite case — preflight succeeded, the
// engine is supported, but there's a newer one available. Two
// distinct UX paths, two distinct triggers.
//
// Throttle:
//   - At most one PyPI fetch per session (module-level latch). A
//     failed fetch does NOT update the per-day timestamp, but also
//     does not retry within the same session — the next activation
//     gets a fresh attempt.
//   - At most one fetch per CHECK_INTERVAL_MS across sessions
//     (globalState timestamp). Default 24 h.
//
// Persistence (globalState):
//   - lastCheckedAt: ms epoch of the last successful PyPI fetch.
//   - skippedVersion: version the user explicitly chose to skip via
//     "Skip this version". A later release re-prompts.

import * as vscode from "vscode";
import { upgradeInTerminal } from "./install";
import * as clientLog from "./log";
import { isAtLeast } from "./preflight";

export const LAST_CHECKED_STATE_KEY = "pipelineCheck.engineUpdates.lastCheckedAt";
export const SKIPPED_VERSION_STATE_KEY = "pipelineCheck.engineUpdates.skippedVersion";

export const SETTING_CHECK_ENABLED = "engineUpdates.checkEnabled";

// Default cadence: once per 24 hours. Chosen so a developer who
// keeps VS Code open across days sees an update within a day of it
// landing on PyPI, without paying the network round-trip on every
// activation. Exposed for tests that want to drive the throttle
// directly without mutating Date.now().
export const DEFAULT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// PyPI's JSON endpoint for the `pipeline-check` package. The
// {info: {version: "X.Y.Z"}} field is the canonical "latest stable"
// release per PyPI's own classifier — pre-releases live under
// `releases` but don't take this slot, which matches what we want
// (a casual user shouldn't be nudged to install an RC).
export const PYPI_URL = "https://pypi.org/pypi/pipeline-check/json";

// Network-call ceiling. PyPI's JSON endpoint usually returns in
// well under a second; 5 s is generous without hanging activation
// on a slow / blocked link.
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;

// Per-session latch. Set on the first attempt (success OR failure)
// so we don't hit PyPI twice in one session — once is enough for
// the "is there a newer version?" question, and a transient failure
// during this VS Code window's lifetime shouldn't cause a retry
// loop.
let sessionChecked = false;

/**
 * Reset the per-session latch. Test-only; the production code
 * never clears it (a new VS Code session is the natural reset).
 */
export function _resetSessionLatchForTesting(): void {
  sessionChecked = false;
}

/**
 * Minimal fetch surface the orchestration depends on. Production
 * uses Node's global `fetch` (Node 18+, available in every VS Code
 * 1.85+ host); tests inject a deterministic implementation.
 */
export type FetchImpl = (
  url: string,
  init?: { readonly signal?: AbortSignal },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Query PyPI for the latest stable version of `pipeline-check`.
 * Returns the version string on success, undefined on any failure
 * (network error, non-2xx, malformed JSON, timeout). Failures are
 * logged to the client log channel — the user never sees a toast
 * about "PyPI was unreachable", because that's noise for a
 * background nicety they didn't ask about.
 */
export async function fetchLatestVersion(options: {
  readonly fetchImpl?: FetchImpl;
  readonly timeoutMs?: number;
} = {}): Promise<string | undefined> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchImpl | undefined);
  if (!fetchImpl) {
    clientLog.warn("engine-updates: no fetch implementation available");
    return undefined;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(PYPI_URL, { signal: controller.signal });
    if (!res.ok) {
      clientLog.warn(`engine-updates: PyPI returned HTTP ${res.status}`);
      return undefined;
    }
    const body = (await res.json()) as { info?: { version?: unknown } } | null;
    const version = body?.info?.version;
    if (typeof version !== "string" || version.length === 0) {
      clientLog.warn("engine-updates: PyPI response missing info.version");
      return undefined;
    }
    return version.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    clientLog.warn(`engine-updates: PyPI fetch failed — ${message}`);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pure throttle check. Returns true when enough time has elapsed
 * since the last successful PyPI fetch to warrant another one.
 * Treats undefined `lastCheckedAt` as "never checked, due now",
 * which makes first-install fire on the user's first activation.
 */
export function shouldCheck(
  now: number,
  lastCheckedAt: number | undefined,
  intervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
): boolean {
  if (lastCheckedAt === undefined) return true;
  // Defensive against clock skew (system clock moved backwards while
  // VS Code was running, or the persisted value got corrupted to a
  // future timestamp). Either way, "more than intervalMs in the
  // future" is bogus state; treat it as "due now" so we recover on
  // the next fetch.
  if (lastCheckedAt > now + intervalMs) return true;
  return now - lastCheckedAt >= intervalMs;
}

/**
 * Compose the user-facing notification text. Exported for unit
 * testing. Pins both versions so the user knows exactly what's
 * changing without expanding the notification.
 */
export function composeUpdateMessage(
  currentVersion: string,
  latestVersion: string,
): string {
  return `Pipeline-Check engine v${latestVersion} is available (you have v${currentVersion}).`;
}

export interface CheckOptions {
  /** Override the per-day cadence (tests). */
  readonly intervalMs?: number;
  /** Inject a deterministic clock (tests). */
  readonly now?: () => number;
  /** Inject a fake PyPI fetch (tests). */
  readonly fetchImpl?: FetchImpl;
  /** Inject the upgrade trigger so tests can assert it without spawning a terminal. */
  readonly onUpgrade?: () => void;
  /**
   * Bypass the per-session latch. Tests that exercise multiple
   * decision branches in one file need this; production never
   * passes it.
   */
  readonly bypassSessionLatch?: boolean;
}

/**
 * The outcome the caller (and tests) can dispatch on. `disabled`
 * and `throttled` are the silent no-ops; `no_newer` means we
 * checked and the user is already current; `skipped` means the
 * latest version matches a previously-skipped one; `prompted`
 * means the notification fired. Includes the chosen action when
 * the user engaged.
 */
export type CheckOutcome =
  | { readonly kind: "disabled" }
  | { readonly kind: "throttled" }
  | { readonly kind: "fetch_failed" }
  | { readonly kind: "no_newer"; readonly latestVersion: string }
  | { readonly kind: "skipped"; readonly latestVersion: string }
  | {
      readonly kind: "prompted";
      readonly latestVersion: string;
      readonly choice: "upgrade" | "skip" | "dismissed";
    };

/**
 * Run the daily PyPI check. Fire-and-forget from the caller's
 * perspective — every failure path is silent and logged. Returns
 * the outcome so tests (and any future telemetry surface) can
 * confirm which branch fired.
 *
 * Wired from [src/extension.ts] after a successful preflight: at
 * that point we know the engine version and the user has a
 * working install, so the upgrade prompt is actionable.
 */
export async function checkForEngineUpdate(
  context: vscode.ExtensionContext,
  currentEngineVersion: string,
  options: CheckOptions = {},
): Promise<CheckOutcome> {
  const config = vscode.workspace.getConfiguration("pipelineCheck");
  if (!config.get<boolean>(SETTING_CHECK_ENABLED, true)) {
    return { kind: "disabled" };
  }
  if (sessionChecked && !options.bypassSessionLatch) {
    return { kind: "throttled" };
  }
  const now = (options.now ?? Date.now)();
  const lastCheckedAt = context.globalState.get<number>(LAST_CHECKED_STATE_KEY);
  const intervalMs = options.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  if (!shouldCheck(now, lastCheckedAt, intervalMs)) {
    return { kind: "throttled" };
  }
  // Latch BEFORE the await so a concurrent caller in the same
  // session can't slip a second fetch in while we wait on the
  // network. Cleared only by the per-session reset (test seam).
  sessionChecked = true;
  const latestVersion = await fetchLatestVersion({ fetchImpl: options.fetchImpl });
  if (!latestVersion) {
    return { kind: "fetch_failed" };
  }
  // Persist the success timestamp before any UI work so a missed
  // toast (user closed the window before clicking) doesn't cause
  // a re-prompt at the next activation. Same lesson as
  // showWhatsNewIfUpgraded — persist-then-prompt is safer than
  // prompt-then-persist for fire-and-forget surfaces.
  await context.globalState.update(LAST_CHECKED_STATE_KEY, now);
  if (!isAtLeast(latestVersion, currentEngineVersion) ||
      latestVersion === currentEngineVersion) {
    // Either the same version or older (the user is on a
    // pre-release ahead of PyPI's stable). Nothing to nudge about.
    return { kind: "no_newer", latestVersion };
  }
  // isAtLeast(latest, current) is true AND they aren't equal, so
  // latest is strictly newer than current.
  const skippedVersion = context.globalState.get<string>(SKIPPED_VERSION_STATE_KEY);
  if (skippedVersion === latestVersion) {
    return { kind: "skipped", latestVersion };
  }
  clientLog.info(
    `engine-updates: prompting (current v${currentEngineVersion}, latest v${latestVersion})`,
  );
  const UPGRADE = "Upgrade in terminal";
  const SKIP = "Skip this version";
  const choice = await vscode.window.showInformationMessage(
    composeUpdateMessage(currentEngineVersion, latestVersion),
    UPGRADE,
    SKIP,
  );
  if (choice === UPGRADE) {
    (options.onUpgrade ?? upgradeInTerminal)();
    return { kind: "prompted", latestVersion, choice: "upgrade" };
  }
  if (choice === SKIP) {
    await context.globalState.update(SKIPPED_VERSION_STATE_KEY, latestVersion);
    return { kind: "prompted", latestVersion, choice: "skip" };
  }
  return { kind: "prompted", latestVersion, choice: "dismissed" };
}
