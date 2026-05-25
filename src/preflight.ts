// Fast-fail import check that runs before LanguageClient.start() spawns
// the LSP. The 30-second start timeout is the right ceiling for a slow
// interpreter cold-starting on Windows, but if the user installed the
// extension without `pip install "pipeline-check[lsp]"`, paying 30s to
// learn that is awful UX. A short Python probe fails in well under a
// second, and we surface the install action immediately.
//
// The same probe also captures the engine version via
// `importlib.metadata`, so the caller can:
//   - log `[client] engine version X.Y.Z` for triage breadcrumbs
//   - surface the version in the status-bar tooltip
//   - assert it meets MIN_ENGINE_VERSION and offer an Upgrade action
//     when the user's install is too old to support the extension
//     features we depend on
//
// The probe is *gated* (shouldPreflight) so a user with a custom
// serverCommand / serverArgs (e.g. a wrapper script that bootstraps
// pipeline_check from a non-default location) doesn't get a false
// negative — we only probe when the config matches our default
// "python -m pipeline_check.lsp" shape. Anything else falls through to
// the normal start path, where the existing timeout still bounds the
// damage.

import { spawn } from "node:child_process";

// Default ceiling for the probe. ~5s is a comfortable upper bound on
// "Python interpreter cold-starts and imports pipeline_check" on every
// platform we ship to — much shorter than the LSP's 30s budget because
// the probe doesn't compile pyc files for the whole LSP package, just
// for what `import pipeline_check` pulls in.
const DEFAULT_TIMEOUT_MS = 5_000;

// Matches the Python interpreter form we know we can safely invoke
// `-c "..."` against. Excludes wrapper scripts, batch files, or any
// other launcher whose `-c` semantics we can't trust.
const PYTHON_BASENAME = /^python(\d+(\.\d+)?)?(\.exe)?$/i;

/**
 * Minimum upstream `pipeline-check` version this extension release was
 * built against. The preflight rejects anything older and surfaces an
 * Upgrade toast.
 *
 * **Bump this when an extension change relies on a feature the older
 * engine doesn't provide** — e.g. a new `Diagnostic.data.*` field, a
 * server-side `CodeAction` provider, or an LSP capability we now call
 * through. The number is the user-visible contract: bumping it forces
 * the upgrade prompt for anyone behind, so the change deserves a
 * CHANGELOG note.
 *
 * Today's value (`"1.0.0"`) is the 1.x major floor: any 1.0.x install
 * satisfies it, anyone on a 0.x release sees the upgrade prompt. The
 * extension reads `Diagnostic.code.target` (rule docs URL) and
 * `data.severity` (panel grouping) from publishes; both have been
 * stable across the 1.x line. Bump the patch (or minor) here when the
 * extension starts depending on a newer field.
 */
export const MIN_ENGINE_VERSION = "1.0.0";

// Python probe. One spawn, two outputs:
//   - `import pipeline_check` validates the LSP package is loadable
//     (catches partial installs where metadata exists but the import
//     fails — corrupt pyc, missing C extension, etc.)
//   - `importlib.metadata.version('pipeline-check')` reads the version
//     pip recorded; we print it on a single stdout line.
// We use importlib.metadata (stdlib since 3.8) rather than
// `pipeline_check.__version__` because not every release of every
// package defines `__version__`; the metadata is the canonical source.
const PROBE_SCRIPT =
  "import pipeline_check; " +
  "import importlib.metadata; " +
  "print(importlib.metadata.version('pipeline-check'))";

/**
 * Decide whether to run the preflight import probe given the
 * effective serverCommand / serverArgs. We only probe when the args
 * look like our default `-m pipeline_check.lsp` shape AND the command
 * looks like a Python interpreter — otherwise a wrapper script that
 * legitimately bootstraps pipeline_check would see a spurious failure.
 *
 * Pure function: tests cover the gate without spawning a process.
 */
export function shouldPreflight(
  command: string,
  args: readonly string[],
): boolean {
  if (args.length < 2) return false;
  if (args[0] !== "-m") return false;
  if (!args[1].startsWith("pipeline_check")) return false;
  const basename = (command.split(/[\\/]/).pop() ?? "").toLowerCase();
  return PYTHON_BASENAME.test(basename);
}

/**
 * Minimal injectable spawn surface so tests can exercise the
 * probe-orchestration code (timeout race, exit-code handling,
 * stdout/stderr capture) without booting Python. Production callers
 * leave `spawner` unset and get the default child_process.spawn shim
 * below.
 */
export interface PreflightSpawner {
  (command: string, args: readonly string[]): {
    readonly done: Promise<{
      readonly code: number | null;
      readonly stdout: string;
      readonly stderr: string;
    }>;
    kill(): void;
  };
}

export interface PreflightOptions {
  readonly timeoutMs?: number;
  readonly spawner?: PreflightSpawner;
  /**
   * Override the minimum engine version the probe enforces. Defaults
   * to MIN_ENGINE_VERSION; exposed so tests can pin both the "old
   * engine fails" and "exactly-minimum engine passes" branches without
   * monkey-patching module state.
   */
  readonly minVersion?: string;
}

export interface PreflightOk {
  /** Engine version reported by `importlib.metadata`. */
  readonly version: string;
}

/**
 * Why a preflight failed. The extension uses this to decide between
 * the "Install in terminal" CTA (missing / import error) and the
 * "Upgrade in terminal" CTA (version too old) — they target different
 * pip commands, so the distinction matters.
 */
export type PreflightFailureReason =
  | "missing"
  | "out_of_date"
  | "timeout"
  | "other";

export class PreflightError extends Error {
  constructor(
    message: string,
    readonly reason: PreflightFailureReason,
    /** Engine version captured before the failure, if any. */
    readonly version?: string,
  ) {
    super(message);
    this.name = "PreflightError";
  }
}

/**
 * Spawn the import probe, capture the engine version, and assert it
 * meets MIN_ENGINE_VERSION. Resolves with the captured version on
 * success; throws PreflightError with a reason code on every failure
 * path the caller knows how to react to differently.
 */
export async function runPreflight(
  command: string,
  options: PreflightOptions = {},
): Promise<PreflightOk> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawner = options.spawner ?? defaultSpawner;
  const minVersion = options.minVersion ?? MIN_ENGINE_VERSION;
  const { done, kill } = spawner(command, ["-c", PROBE_SCRIPT]);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      kill();
    } catch {
      // Best-effort kill — if the child is already gone the OS will
      // tell us so. Either way `done` will resolve and we report the
      // timeout below.
    }
  }, timeoutMs);

  try {
    const { code, stdout, stderr } = await done;
    if (timedOut) {
      throw new PreflightError(
        `pipeline_check import probe timed out after ${Math.round(
          timeoutMs / 1000,
        )}s; the interpreter at "${command}" may be hung`,
        "timeout",
      );
    }
    if (code !== 0) {
      throw classifyFailure(code, stderr, command);
    }
    const version = stdout.trim().split(/\r?\n/).pop()?.trim() ?? "";
    if (!version) {
      // The probe printed nothing on a zero exit. Shouldn't happen
      // with a well-formed package, but if importlib.metadata returns
      // an empty string we don't want a silent "engine 0.0.0".
      throw new PreflightError(
        `pipeline_check is installed but reported no version; the install may be corrupt`,
        "other",
      );
    }
    if (!isAtLeast(version, minVersion)) {
      throw new PreflightError(
        `pipeline_check engine v${version} is older than the minimum required by this extension (v${minVersion}); please upgrade`,
        "out_of_date",
        version,
      );
    }
    return { version };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate the probe's (exitCode, stderr) into a PreflightError shape
 * the caller can dispatch on. Exported via the unit-test seam below.
 */
function classifyFailure(
  exitCode: number | null,
  stderr: string,
  command: string,
): PreflightError {
  const trimmed = stderr.trim();
  // Python's standard "package not installed" traceback ends in either
  // `ModuleNotFoundError: No module named '...'` (3.6+) or the older
  // `ImportError: No module named ...`. Either way the message we want
  // to show is the same: the install command sits one click away on
  // the toast we surface this from.
  if (
    trimmed.includes("ModuleNotFoundError") ||
    trimmed.includes("No module named")
  ) {
    return new PreflightError(
      `pipeline_check is not installed for the Python interpreter at "${command}"`,
      "missing",
    );
  }
  // PackageNotFoundError fires when the module exists but pip's
  // metadata is missing (an editable install that lost its .dist-info,
  // a wheel extracted by hand). The fix is the same — reinstall via
  // pip — so we route it through the same "missing" CTA.
  if (trimmed.includes("PackageNotFoundError")) {
    return new PreflightError(
      `pipeline_check is installed but pip metadata is missing for "${command}"; please reinstall via pip`,
      "missing",
    );
  }
  if (trimmed) {
    const lastLine = trimmed.split(/\r?\n/).pop() ?? trimmed;
    return new PreflightError(
      `pipeline_check import probe failed: ${lastLine}`,
      "other",
    );
  }
  return new PreflightError(
    `pipeline_check import probe failed (exit ${exitCode ?? "?"})`,
    "other",
  );
}

// Re-export the formatter under its original name for any external
// consumer that imported it pre-refactor. Internal call sites use
// classifyFailure directly so they get the reason code too.
export function formatPreflightFailure(
  exitCode: number | null,
  stderr: string,
  command: string,
): string {
  return classifyFailure(exitCode, stderr, command).message;
}

interface ParsedVersion {
  readonly parts: readonly number[];
  /**
   * True when the version had a non-numeric suffix (e.g. "1.2.3rc1",
   * "1.2.3.dev2", "1.2.3-alpha"). Pre-releases compare LESS than the
   * corresponding release per PEP 440 / SemVer convention.
   */
  readonly prerelease: boolean;
}

/**
 * Parse a version string into its numeric segments plus a prerelease
 * flag. Exported for unit testing; not part of the public preflight
 * API otherwise.
 */
export function parseVersion(version: string): ParsedVersion {
  const trimmed = version.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)*)(.*)$/);
  if (!match) return { parts: [], prerelease: trimmed.length > 0 };
  const numeric = match[1].split(".").map((p) => parseInt(p, 10));
  const tail = match[2].trim();
  return { parts: numeric, prerelease: tail.length > 0 };
}

/**
 * Lexicographic version comparison. Returns true iff `actual` is at
 * least `required`. Handles common shapes:
 *
 *   isAtLeast("1.2.3",   "1.2.3")   → true   (equal)
 *   isAtLeast("1.2.4",   "1.2.3")   → true
 *   isAtLeast("1.2.2",   "1.2.3")   → false
 *   isAtLeast("2.0.0",   "1.99.99") → true
 *   isAtLeast("1.2",     "1.2.3")   → false  (missing patch = 0)
 *   isAtLeast("1.2.3rc1","1.2.3")   → false  (prerelease < release)
 *   isAtLeast("1.2.4rc1","1.2.3")   → true   (numeric still wins)
 *
 * Not a full PEP 440 / SemVer implementation — those would pull in a
 * dependency for value we don't extract. The cases that matter for
 * pipeline-check release shapes (numeric MAJOR.MINOR.PATCH plus
 * occasional rc/dev tails) are covered.
 */
export function isAtLeast(actual: string, required: string): boolean {
  const a = parseVersion(actual);
  const r = parseVersion(required);
  const len = Math.max(a.parts.length, r.parts.length);
  for (let i = 0; i < len; i++) {
    const ai = a.parts[i] ?? 0;
    const ri = r.parts[i] ?? 0;
    if (ai > ri) return true;
    if (ai < ri) return false;
  }
  // Numeric parts equal. A prerelease ranks BELOW the corresponding
  // release, so the prerelease-actual + release-required combination
  // fails; everything else passes.
  if (a.prerelease && !r.prerelease) return false;
  return true;
}

const defaultSpawner: PreflightSpawner = (command, args) => {
  // windowsHide suppresses the brief console window flash a stdio
  // spawn would otherwise paint on Windows. stdio captures stdout
  // (for the version line) and stderr (for failure classification);
  // stdin is `ignore` so the child can't block waiting on input.
  const child = spawn(command, [...args], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += typeof chunk === "string" ? chunk : chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += typeof chunk === "string" ? chunk : chunk.toString();
  });
  const done = new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    let settled = false;
    // 'error' fires when the binary can't be spawned at all (ENOENT,
    // EACCES). Surface that as a synthetic non-zero exit so the
    // formatter's stderr branch picks it up and the user sees the
    // OS-level reason rather than an "exit ?" placeholder.
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      const detail = err.code ? `${err.code}: ${err.message}` : err.message;
      resolve({ code: null, stdout, stderr: stderr || detail });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    });
  });
  return {
    done,
    kill: () => {
      try {
        child.kill();
      } catch {
        // ESRCH (already exited) is fine; nothing to clean up.
      }
    },
  };
};
