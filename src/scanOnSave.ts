// Scan-on-save handler factory. Extracted from extension.ts's
// activate() closure so the busy-guard semantics, the config gate,
// and the provider gate can be exercised without a real
// onDidSaveTextDocument event source.
//
// Pure injection: the factory takes everything it needs as deps. The
// real wiring in extension.ts plugs in vscode.workspace.getConfiguration
// for the enable flag, providerForPath for the file-match check, and
// scanWorkspace for the scanner. Tests swap each for synthetic
// versions that count calls and let the test drive timing.

/** Minimal text-document shape the handler reads. */
export interface SavedDocument {
  readonly uri: { readonly fsPath: string };
}

/**
 * Anything the scan-on-save handler needs from the outside world.
 * Keeping every dependency on this interface lets the test instantiate
 * the handler without importing vscode, providers.ts, or
 * workspaceScan.ts.
 */
export interface ScanOnSaveDeps {
  /** True when `pipelineCheck.scanOnSave` is enabled. Re-read on each save. */
  readonly isEnabled: () => boolean;
  /**
   * True when a save of `fsPath` should trigger a workspace scan.
   * Bundles the path-classifier and the disabled-provider check:
   * a save of a file whose provider is disabled never triggers a
   * scan, since the user has signaled the findings should be
   * silenced anyway — re-scanning would just re-publish a batch
   * the middleware drops on arrival. The combined check also keeps
   * the "all providers disabled" edge case efficient (every save
   * short-circuits without enumerating the workspace).
   */
  readonly shouldScanOnSave: (fsPath: string) => boolean;
  /** Scan the workspace. Receives no arguments — the handler always quiets. */
  readonly scan: () => Promise<unknown>;
  /**
   * Invoked when `scan()` rejects. Optional; defaults to silent. The
   * handler is registered as a fire-and-forget `onDidSaveTextDocument`
   * listener, so a rejection that escapes would surface only as an
   * "unhandled promise rejection" in the extension-host log. Routing
   * it through this hook lets the production wiring write a real log
   * line to the Pipeline-Check output channel while the unit tests
   * inject a capturing function. Background save-driven scans don't
   * surface a toast on failure — interrupting a save flow with a
   * modal is worse than the failure itself.
   */
  readonly onError?: (err: unknown) => void;
}

/**
 * Build a save handler closing over a single `busy` flag. Returning a
 * closure (rather than a class) gives every call site its own flag —
 * two extension hosts in two windows can't accidentally share the
 * lock.
 *
 * The busy guard collapses save-storms (autosave, Save All) to one
 * scan. A storm-tail save that arrives after the scan finishes still
 * starts a fresh scan, which is the right semantics for cross-file
 * effects: we don't want to skip the LAST save of a storm.
 *
 * A `scan()` rejection releases the lock (so a transient failure
 * doesn't silence the rest of the session) and routes the error
 * through `deps.onError`. The handler never re-throws — VS Code
 * doesn't await save listeners, so a propagated rejection would land
 * as an unhandled rejection in the extension-host log instead of a
 * useful breadcrumb the user can read.
 */
export function createScanOnSaveHandler(
  deps: ScanOnSaveDeps,
): (doc: SavedDocument) => Promise<void> {
  let busy = false;
  return async (doc) => {
    // Order matters: the cheapest gates run first so a non-CI save
    // (the common case) costs only one config read and one regex
    // test, not a full scan setup.
    if (!deps.isEnabled()) return;
    if (!deps.shouldScanOnSave(doc.uri.fsPath)) return;
    if (busy) return;
    busy = true;
    try {
      await deps.scan();
    } catch (err) {
      deps.onError?.(err);
    } finally {
      busy = false;
    }
  };
}
