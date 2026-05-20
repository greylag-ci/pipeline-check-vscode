import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({}));

import {
  createScanOnSaveHandler,
  type SavedDocument,
  type ScanOnSaveDeps,
} from "./scanOnSave";

function doc(fsPath: string): SavedDocument {
  return { uri: { fsPath } };
}

/**
 * Build a deps object with sensible defaults that the tests can
 * override field-by-field. `scan` returns a promise the test can
 * resolve/reject explicitly, which is how the busy-guard tests
 * inspect the in-flight window.
 */
function makeDeps(
  overrides: Partial<ScanOnSaveDeps> & {
    scanPromise?: Promise<unknown>;
  } = {},
): {
  deps: ScanOnSaveDeps;
  scanCalls: number;
  scanResolvers: Array<() => void>;
} {
  const scanResolvers: Array<() => void> = [];
  const calls = { scan: 0 };
  const deps: ScanOnSaveDeps = {
    isEnabled: overrides.isEnabled ?? (() => true),
    shouldScanOnSave: overrides.shouldScanOnSave ?? (() => true),
    scan:
      overrides.scan ??
      (() => {
        calls.scan += 1;
        if (overrides.scanPromise) return overrides.scanPromise;
        return new Promise<void>((res) => {
          scanResolvers.push(res);
        });
      }),
  };
  return {
    deps,
    get scanCalls() {
      return calls.scan;
    },
    scanResolvers,
  } as unknown as ReturnType<typeof makeDeps>;
}

describe("createScanOnSaveHandler", () => {
  // The handler closes over a single boolean so the busy semantics
  // and the gate checks can be locked down without a real save
  // stream. The cheap-gates-first ordering (isEnabled before
  // shouldScanOnSave before busy) is the contract — it means a
  // non-CI save in a workspace with scanOnSave off pays only one
  // config read.

  it("returns immediately when scanOnSave is disabled", async () => {
    const fake = makeDeps({ isEnabled: () => false });
    const handler = createScanOnSaveHandler(fake.deps);
    await handler(doc("/repo/.gitlab-ci.yml"));
    expect(fake.scanCalls).toBe(0);
  });

  it("returns immediately when shouldScanOnSave gates the file out", async () => {
    // shouldScanOnSave returns false for either (a) non-CI files
    // (package.json, mkdocs.yml, etc.) or (b) CI files whose
    // provider the user has put in `disabledProviders`. Either way
    // the handler bails before locking the busy flag.
    const fake = makeDeps({ shouldScanOnSave: () => false });
    const handler = createScanOnSaveHandler(fake.deps);
    await handler(doc("/repo/package.json"));
    expect(fake.scanCalls).toBe(0);
  });

  it("scans when both gates pass", async () => {
    const fake = makeDeps();
    const handler = createScanOnSaveHandler(fake.deps);
    // Start the save handler but don't await yet — the scan promise
    // stays unresolved so we can inspect the in-flight state.
    const inFlight = handler(doc("/repo/.gitlab-ci.yml"));
    expect(fake.scanCalls).toBe(1);
    fake.scanResolvers[0]();
    await inFlight;
  });

  it("collapses a save-storm to a single scan via the busy guard", async () => {
    // Save All / autosave can drop ten saves in flight at once. The
    // guard turns this into one scan; tail saves arriving while the
    // scan runs are dropped.
    const fake = makeDeps();
    const handler = createScanOnSaveHandler(fake.deps);
    const first = handler(doc("/repo/.gitlab-ci.yml"));
    void handler(doc("/repo/.github/workflows/ci.yml"));
    void handler(doc("/repo/Jenkinsfile"));
    expect(fake.scanCalls).toBe(1);
    fake.scanResolvers[0]();
    await first;
  });

  it("releases the busy lock so a later save still scans", async () => {
    // The busy guard is per-call — once a scan finishes, the next
    // save proceeds normally. Tail saves at the very end of a storm
    // were the original motivation for this fix.
    const fake = makeDeps();
    const handler = createScanOnSaveHandler(fake.deps);
    const first = handler(doc("/repo/.gitlab-ci.yml"));
    fake.scanResolvers[0]();
    await first;
    expect(fake.scanCalls).toBe(1);
    const second = handler(doc("/repo/.gitlab-ci.yml"));
    expect(fake.scanCalls).toBe(2);
    fake.scanResolvers[1]();
    await second;
  });

  it("swallows a scan rejection, routes it through onError, and re-arms the same handler", async () => {
    // Three contracts in one test, because they're load-bearing
    // together:
    //   (1) The handler does NOT re-throw. VS Code's
    //       onDidSaveTextDocument is fire-and-forget; a propagated
    //       rejection lands as an "unhandled promise rejection" in
    //       the extension-host log, divorced from any user action.
    //   (2) `onError` runs so the breadcrumb reaches the log channel.
    //   (3) The SAME handler instance accepts a subsequent save —
    //       the lock-release in `finally` is per-call, not per-life.
    //       A previous test version used a fresh handler2 here and
    //       only proved that the closure-init code works.
    const errors: unknown[] = [];
    let scanCalls = 0;
    let nextRejects = true;
    const deps: ScanOnSaveDeps = {
      isEnabled: () => true,
      shouldScanOnSave: () => true,
      scan: () => {
        scanCalls += 1;
        return nextRejects
          ? Promise.reject(new Error("transient"))
          : Promise.resolve();
      },
      onError: (err) => {
        errors.push(err);
      },
    };
    const handler = createScanOnSaveHandler(deps);

    // First save rejects; the handler resolves cleanly and the error
    // is captured.
    await expect(handler(doc("/repo/.gitlab-ci.yml"))).resolves.toBeUndefined();
    expect(scanCalls).toBe(1);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("transient");

    // Second save on the SAME handler must scan. If the lock leaked,
    // the busy flag would still be on and this would be a no-op.
    nextRejects = false;
    await handler(doc("/repo/.gitlab-ci.yml"));
    expect(scanCalls).toBe(2);
    expect(errors).toHaveLength(1); // no new error
  });

  it("is silent on rejection when onError is omitted (default no-op)", async () => {
    // `onError` is optional; tests and any caller that doesn't care
    // about the failure path can leave it off. The handler still
    // resolves rather than re-throwing.
    const deps: ScanOnSaveDeps = {
      isEnabled: () => true,
      shouldScanOnSave: () => true,
      scan: () => Promise.reject(new Error("transient")),
    };
    const handler = createScanOnSaveHandler(deps);
    await expect(handler(doc("/repo/.gitlab-ci.yml"))).resolves.toBeUndefined();
  });

  it("re-evaluates isEnabled on every save (not cached)", async () => {
    // A user toggles the setting from off to on mid-session; the
    // very next save should pick it up without an extension reload.
    let enabled = false;
    const fake = makeDeps({
      isEnabled: () => enabled,
    });
    const handler = createScanOnSaveHandler(fake.deps);
    await handler(doc("/repo/.gitlab-ci.yml"));
    expect(fake.scanCalls).toBe(0);
    enabled = true;
    const inFlight = handler(doc("/repo/.gitlab-ci.yml"));
    expect(fake.scanCalls).toBe(1);
    fake.scanResolvers[0]();
    await inFlight;
  });

  it("checks isEnabled BEFORE shouldScanOnSave (cheap gate first)", async () => {
    // When scanOnSave is off, we shouldn't even bother classifying
    // the saved path. Locks down the cheap-gates-first ordering so
    // a future refactor doesn't accidentally invert it and add a
    // providerForPath call on every save in a workspace that has
    // scan-on-save disabled.
    let shouldScanCalls = 0;
    const deps: ScanOnSaveDeps = {
      isEnabled: () => false,
      shouldScanOnSave: () => {
        shouldScanCalls += 1;
        return true;
      },
      scan: () => Promise.resolve(),
    };
    const handler = createScanOnSaveHandler(deps);
    await handler(doc("/repo/.gitlab-ci.yml"));
    expect(shouldScanCalls).toBe(0);
  });

  it("re-evaluates shouldScanOnSave on every save (disabled-providers can flip)", async () => {
    // A user updates `pipelineCheck.disabledProviders` mid-session
    // and saves again; the handler must consult the live value, not
    // a snapshot taken at construction.
    let disabled = false;
    const fake = makeDeps({
      shouldScanOnSave: () => !disabled,
    });
    const handler = createScanOnSaveHandler(fake.deps);
    const first = handler(doc("/repo/Dockerfile"));
    fake.scanResolvers[0]();
    await first;
    expect(fake.scanCalls).toBe(1);
    // Now silence the provider.
    disabled = true;
    await handler(doc("/repo/Dockerfile"));
    expect(fake.scanCalls).toBe(1); // no new scan
    // And unsilence.
    disabled = false;
    const third = handler(doc("/repo/Dockerfile"));
    fake.scanResolvers[1]();
    await third;
    expect(fake.scanCalls).toBe(2);
  });

  it("each handler instance has its own busy flag (no cross-instance lock)", async () => {
    // Two extension hosts (two windows on the same workspace) get
    // their own handler instance. A save in one mustn't lock the
    // other.
    const first = makeDeps();
    const second = makeDeps();
    const h1 = createScanOnSaveHandler(first.deps);
    const h2 = createScanOnSaveHandler(second.deps);
    const p1 = h1(doc("/repo/.gitlab-ci.yml"));
    const p2 = h2(doc("/repo/.gitlab-ci.yml"));
    expect(first.scanCalls).toBe(1);
    expect(second.scanCalls).toBe(1);
    first.scanResolvers[0]();
    second.scanResolvers[0]();
    await Promise.all([p1, p2]);
  });
});
