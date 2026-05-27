import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub vscode so checkForEngineUpdate can read configuration and
// publish a notification without a real extension host. Mirrors
// the shape used by whatsNew.test.ts so the patterns are familiar.
vi.mock("vscode", () => {
  const calls: {
    showInformationMessage: Array<{ message: string; actions: string[] }>;
  } = { showInformationMessage: [] };
  (globalThis as { __engineUpdatesCalls?: typeof calls }).__engineUpdatesCalls =
    calls;
  return {
    window: {
      showInformationMessage: (message: string, ...actions: string[]) => {
        calls.showInformationMessage.push({ message, actions });
        const next = (globalThis as { __nextChoice?: string }).__nextChoice;
        return Promise.resolve(next);
      },
    },
    workspace: {
      getConfiguration: (_section?: string) => ({
        get: <T>(key: string, fallback?: T): T => {
          const store = (globalThis as { __config?: Record<string, unknown> })
            .__config ?? {};
          if (key in store) return store[key] as T;
          return fallback as T;
        },
      }),
    },
  };
});

// install.ts is pulled in transitively (upgradeInTerminal is the
// default `onUpgrade`). We mock it so production code never
// touches a real terminal during tests.
vi.mock("./install", () => ({
  upgradeInTerminal: () => {
    (globalThis as { __upgradeCalls?: number }).__upgradeCalls =
      ((globalThis as { __upgradeCalls?: number }).__upgradeCalls ?? 0) + 1;
  },
}));

// log.ts is fine as-is (silent no-op without a channel), no mock
// needed.

import {
  _resetSessionLatchForTesting,
  checkForEngineUpdate,
  composeUpdateMessage,
  DEFAULT_CHECK_INTERVAL_MS,
  fetchLatestVersion,
  LAST_CHECKED_STATE_KEY,
  SKIPPED_VERSION_STATE_KEY,
  shouldCheck,
  type FetchImpl,
} from "./engineUpdates";

function getCalls() {
  return (
    globalThis as {
      __engineUpdatesCalls?: {
        showInformationMessage: Array<{ message: string; actions: string[] }>;
      };
    }
  ).__engineUpdatesCalls!;
}

function fakeContext(initial: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = { ...initial };
  return {
    globalState: {
      get<T>(key: string): T | undefined {
        return state[key] as T | undefined;
      },
      async update(key: string, value: unknown): Promise<void> {
        state[key] = value;
      },
    },
  } as unknown as import("vscode").ExtensionContext;
}

function fakeFetch(
  body: unknown,
  options: { readonly ok?: boolean; readonly status?: number } = {},
): FetchImpl {
  return () =>
    Promise.resolve({
      ok: options.ok ?? true,
      status: options.status ?? 200,
      json: () => Promise.resolve(body),
    });
}

beforeEach(() => {
  _resetSessionLatchForTesting();
  getCalls().showInformationMessage.length = 0;
  (globalThis as { __nextChoice?: string }).__nextChoice = undefined;
  (globalThis as { __upgradeCalls?: number }).__upgradeCalls = 0;
  (globalThis as { __config?: Record<string, unknown> }).__config = {};
});

// ─── shouldCheck ─────────────────────────────────────────────────────

describe("shouldCheck", () => {
  it("returns true when no prior check is recorded (first install)", () => {
    expect(shouldCheck(1_000_000, undefined)).toBe(true);
  });

  it("returns true once the interval has elapsed", () => {
    const oneDay = DEFAULT_CHECK_INTERVAL_MS;
    expect(shouldCheck(oneDay + 1, 0)).toBe(true);
  });

  it("returns false within the interval", () => {
    const oneHour = 60 * 60 * 1000;
    expect(shouldCheck(oneHour, 0)).toBe(false);
  });

  it("returns true on exactly the interval boundary (>=, not >)", () => {
    expect(shouldCheck(DEFAULT_CHECK_INTERVAL_MS, 0)).toBe(true);
  });

  it("recovers from a future-dated lastCheckedAt (clock skew defence)", () => {
    // System clock moved backwards / corrupted state. Without the
    // defence we'd be stuck waiting forever for `now` to catch up.
    const farFuture = DEFAULT_CHECK_INTERVAL_MS * 10;
    expect(shouldCheck(0, farFuture)).toBe(true);
  });
});

// ─── composeUpdateMessage ───────────────────────────────────────────

describe("composeUpdateMessage", () => {
  it("pins both the current and latest version so the diff is visible at a glance", () => {
    const msg = composeUpdateMessage("1.0.0", "1.5.0");
    expect(msg).toContain("v1.0.0");
    expect(msg).toContain("v1.5.0");
  });
});

// ─── fetchLatestVersion ─────────────────────────────────────────────

describe("fetchLatestVersion", () => {
  it("returns the info.version string on a 200 response", async () => {
    const v = await fetchLatestVersion({
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
    });
    expect(v).toBe("1.5.0");
  });

  it("trims whitespace from the returned version", async () => {
    const v = await fetchLatestVersion({
      fetchImpl: fakeFetch({ info: { version: "  1.5.0\n" } }),
    });
    expect(v).toBe("1.5.0");
  });

  it("returns undefined on a non-2xx response", async () => {
    const v = await fetchLatestVersion({
      fetchImpl: fakeFetch({}, { ok: false, status: 503 }),
    });
    expect(v).toBeUndefined();
  });

  it("returns undefined when info.version is missing", async () => {
    const v = await fetchLatestVersion({ fetchImpl: fakeFetch({ info: {} }) });
    expect(v).toBeUndefined();
  });

  it("returns undefined when info.version is the empty string", async () => {
    const v = await fetchLatestVersion({
      fetchImpl: fakeFetch({ info: { version: "" } }),
    });
    expect(v).toBeUndefined();
  });

  it("returns undefined on a fetch rejection (network error)", async () => {
    const v = await fetchLatestVersion({
      fetchImpl: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    expect(v).toBeUndefined();
  });

  it("returns undefined when the JSON body is null", async () => {
    const v = await fetchLatestVersion({ fetchImpl: fakeFetch(null) });
    expect(v).toBeUndefined();
  });

  it("returns undefined when no fetch implementation is available", async () => {
    // Force the global-fetch lookup to fail by passing an explicit
    // undefined override that bypasses globalThis.fetch.
    const original = (globalThis as { fetch?: unknown }).fetch;
    try {
      (globalThis as { fetch?: unknown }).fetch = undefined;
      const v = await fetchLatestVersion();
      expect(v).toBeUndefined();
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

// ─── checkForEngineUpdate ───────────────────────────────────────────

describe("checkForEngineUpdate", () => {
  // Each `it` uses a fresh fake context + the per-session latch
  // reset in the global beforeEach.

  it("returns disabled when the setting is off", async () => {
    (globalThis as { __config?: Record<string, unknown> }).__config = {
      "engineUpdates.checkEnabled": false,
    };
    const ctx = fakeContext();
    const outcome = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
    });
    expect(outcome).toEqual({ kind: "disabled" });
    expect(getCalls().showInformationMessage).toHaveLength(0);
  });

  it("returns throttled when called twice in the same session", async () => {
    const ctx = fakeContext();
    const first = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
      onUpgrade: () => undefined,
    });
    expect(first.kind).toBe("prompted");
    const second = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
    });
    expect(second).toEqual({ kind: "throttled" });
  });

  it("returns throttled when the per-day interval has not elapsed", async () => {
    const now = 1_000_000_000;
    const ctx = fakeContext({
      [LAST_CHECKED_STATE_KEY]: now - 60 * 1000, // 1 minute ago
    });
    const outcome = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
      now: () => now,
    });
    expect(outcome).toEqual({ kind: "throttled" });
  });

  it("re-checks after the per-day interval elapses (cross-session)", async () => {
    const now = 1_000_000_000;
    const ctx = fakeContext({
      [LAST_CHECKED_STATE_KEY]: now - DEFAULT_CHECK_INTERVAL_MS - 1,
    });
    const outcome = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
      now: () => now,
      onUpgrade: () => undefined,
    });
    expect(outcome.kind).toBe("prompted");
  });

  it("returns fetch_failed when PyPI is unreachable", async () => {
    const ctx = fakeContext();
    const outcome = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    expect(outcome).toEqual({ kind: "fetch_failed" });
    expect(getCalls().showInformationMessage).toHaveLength(0);
  });

  it("returns no_newer when PyPI's latest equals the current version", async () => {
    const ctx = fakeContext();
    const outcome = await checkForEngineUpdate(ctx, "1.5.0", {
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
    });
    expect(outcome).toEqual({ kind: "no_newer", latestVersion: "1.5.0" });
    expect(getCalls().showInformationMessage).toHaveLength(0);
  });

  it("returns no_newer when the user is on a pre-release ahead of PyPI's stable", async () => {
    // User installed 1.5.0rc1 manually; PyPI's stable is still
    // 1.4.0. The pre-release outranks 1.4.0 numerically, so we
    // should NOT prompt them to downgrade.
    const ctx = fakeContext();
    const outcome = await checkForEngineUpdate(ctx, "1.5.0rc1", {
      fetchImpl: fakeFetch({ info: { version: "1.4.0" } }),
    });
    expect(outcome.kind).toBe("no_newer");
    expect(getCalls().showInformationMessage).toHaveLength(0);
  });

  it("returns skipped when the latest version matches a previously-skipped one", async () => {
    const ctx = fakeContext({
      [SKIPPED_VERSION_STATE_KEY]: "1.5.0",
    });
    const outcome = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
    });
    expect(outcome).toEqual({ kind: "skipped", latestVersion: "1.5.0" });
    expect(getCalls().showInformationMessage).toHaveLength(0);
  });

  it("prompts when a newer version is available and the user has not skipped it", async () => {
    const ctx = fakeContext();
    (globalThis as { __nextChoice?: string }).__nextChoice = undefined;
    const outcome = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
      onUpgrade: () => undefined,
    });
    expect(outcome).toEqual({
      kind: "prompted",
      latestVersion: "1.5.0",
      choice: "dismissed",
    });
    expect(getCalls().showInformationMessage).toHaveLength(1);
    expect(getCalls().showInformationMessage[0].actions).toEqual([
      "Upgrade in terminal",
      "Skip this version",
    ]);
    expect(getCalls().showInformationMessage[0].message).toContain("v1.5.0");
    expect(getCalls().showInformationMessage[0].message).toContain("v1.0.0");
  });

  it("runs the upgrade action when the user picks Upgrade in terminal", async () => {
    (globalThis as { __nextChoice?: string }).__nextChoice =
      "Upgrade in terminal";
    const ctx = fakeContext();
    let upgradeFired = 0;
    const outcome = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
      onUpgrade: () => {
        upgradeFired += 1;
      },
    });
    expect(outcome).toEqual({
      kind: "prompted",
      latestVersion: "1.5.0",
      choice: "upgrade",
    });
    expect(upgradeFired).toBe(1);
  });

  it("persists the skipped version when the user picks Skip this version", async () => {
    (globalThis as { __nextChoice?: string }).__nextChoice = "Skip this version";
    const ctx = fakeContext();
    const outcome = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
      onUpgrade: () => undefined,
    });
    expect(outcome).toEqual({
      kind: "prompted",
      latestVersion: "1.5.0",
      choice: "skip",
    });
    expect(ctx.globalState.get(SKIPPED_VERSION_STATE_KEY)).toBe("1.5.0");
  });

  it("re-prompts for a NEWER release even after the user skipped an older one", async () => {
    // The user said "Skip this version" for 1.5.0 last week. 1.6.0
    // shipped today. They should see THAT prompt — the skip is
    // per-version, not "never bother me again".
    const ctx = fakeContext({
      [SKIPPED_VERSION_STATE_KEY]: "1.5.0",
    });
    const outcome = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: fakeFetch({ info: { version: "1.6.0" } }),
      onUpgrade: () => undefined,
    });
    expect(outcome.kind).toBe("prompted");
    expect((outcome as { latestVersion: string }).latestVersion).toBe("1.6.0");
  });

  it("persists lastCheckedAt on a successful fetch (regardless of outcome)", async () => {
    const now = 1_700_000_000_000;
    const ctx = fakeContext();
    await checkForEngineUpdate(ctx, "1.5.0", {
      // PyPI matches current → no_newer outcome
      fetchImpl: fakeFetch({ info: { version: "1.5.0" } }),
      now: () => now,
    });
    expect(ctx.globalState.get(LAST_CHECKED_STATE_KEY)).toBe(now);
  });

  it("does NOT persist lastCheckedAt on a failed fetch (so the next session retries)", async () => {
    const now = 1_700_000_000_000;
    const ctx = fakeContext();
    await checkForEngineUpdate(ctx, "1.5.0", {
      fetchImpl: () => Promise.reject(new Error("ECONNREFUSED")),
      now: () => now,
    });
    expect(ctx.globalState.get(LAST_CHECKED_STATE_KEY)).toBeUndefined();
  });

  it("the per-session latch holds even when the fetch fails (no in-session retry storms)", async () => {
    const ctx = fakeContext();
    const first = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    expect(first).toEqual({ kind: "fetch_failed" });
    let secondFetchCalled = false;
    const second = await checkForEngineUpdate(ctx, "1.0.0", {
      fetchImpl: () => {
        secondFetchCalled = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ info: { version: "1.5.0" } }),
        });
      },
    });
    expect(second).toEqual({ kind: "throttled" });
    expect(secondFetchCalled).toBe(false);
  });
});
