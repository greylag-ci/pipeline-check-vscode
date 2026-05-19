import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  formatTimeoutMessage,
  startWithTimeout,
  type StartableClient,
} from "./lspStart";

// vitest fake timers let us watch the timeout race fire in millisecond
// time even though the real ceiling is 30 seconds — a real-time test
// would either be flaky (small ceiling, slow CI) or slow (real
// ceiling, multi-second per test).

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Build a StartableClient whose `start()` resolves only when the test
 * explicitly calls `resolveStart()`. Captures every `stop()` invocation
 * so the test can assert the timeout fires the kill switch.
 */
function makeFakeClient(): {
  client: StartableClient;
  resolveStart: () => void;
  rejectStart: (err: unknown) => void;
  stopCalls: number;
} {
  let resolveStart!: () => void;
  let rejectStart!: (err: unknown) => void;
  const startPromise = new Promise<void>((res, rej) => {
    resolveStart = res;
    rejectStart = rej;
  });
  const calls = { stop: 0 };
  const client: StartableClient = {
    start: () => startPromise,
    stop: async () => {
      calls.stop += 1;
    },
  };
  return {
    client,
    resolveStart,
    rejectStart,
    get stopCalls() {
      return calls.stop;
    },
  } as unknown as ReturnType<typeof makeFakeClient>;
}

/**
 * Helper: chain a no-op `.catch` onto the test promise to suppress
 * Node's "unhandled rejection" warning. Fake timers fire the rejection
 * synchronously, well before any `await expect(p).rejects.toThrow(...)`
 * gets a chance to register a handler. Pre-arming `.catch(() => {})`
 * means a handler is on the promise before the timer rejects it,
 * silencing the warning without changing the test's outcome — vitest
 * `.rejects.toThrow(...)` still observes the rejection.
 */
function armRejectionHandler<T>(p: Promise<T>): Promise<T> {
  p.catch(() => undefined);
  return p;
}

describe("startWithTimeout", () => {
  it("resolves when start() wins the race", async () => {
    const { client, resolveStart } = makeFakeClient();
    const p = startWithTimeout(client, 30_000);
    // Settle start() before the timer has any chance to tick.
    resolveStart();
    await expect(p).resolves.toBeUndefined();
  });

  it("rejects with the documented message when the timer wins", async () => {
    const { client } = makeFakeClient();
    const p = armRejectionHandler(startWithTimeout(client, 30_000));
    // Don't resolve start. Push past the ceiling.
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).rejects.toThrow(/did not finish startup within 30s/);
  });

  it("fires client.stop() exactly once on timeout", async () => {
    // The whole point: an interpreter hung at start() needs to be
    // killed so the next startClient() doesn't inherit a half-alive
    // child. Failing to call stop() leaves a zombie subprocess.
    const fake = makeFakeClient();
    const p = armRejectionHandler(startWithTimeout(fake.client, 30_000));
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).rejects.toThrow();
    expect(fake.stopCalls).toBe(1);
  });

  it("does NOT call stop() when start() resolves before the ceiling", async () => {
    // The cleanup stop() is the timeout's escape hatch. If start
    // succeeded, calling stop() afterwards would kill the LSP we
    // just successfully launched.
    const fake = makeFakeClient();
    const p = startWithTimeout(fake.client, 30_000);
    fake.resolveStart();
    await expect(p).resolves.toBeUndefined();
    expect(fake.stopCalls).toBe(0);
  });

  it("clears the timer when start() rejects so the timer-side stop() never fires", async () => {
    // If start() rejects on its own (e.g. spawn ENOENT) the timer
    // should be cleared — otherwise we'd later trigger an
    // unnecessary stop() against a client that already failed.
    const fake = makeFakeClient();
    const p = armRejectionHandler(startWithTimeout(fake.client, 30_000));
    fake.rejectStart(new Error("spawn ENOENT"));
    await expect(p).rejects.toThrow(/ENOENT/);
    // Advance well past the ceiling — if the timer was still armed,
    // the second stop() would have landed here.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.stopCalls).toBe(0);
  });

  it("swallows a rejection from the timeout-side stop() without surfacing it", async () => {
    // A hung interpreter's stop() can reject ("server did not
    // acknowledge"); we still want the user to see the
    // "did not finish startup" error, not a confusing
    // "stop failed" error.
    let resolveStart!: () => void;
    const startPromise = new Promise<void>((res) => {
      resolveStart = res;
    });
    const client: StartableClient = {
      start: () => startPromise,
      stop: () =>
        Promise.reject(new Error("server did not acknowledge stop")),
    };
    const p = armRejectionHandler(startWithTimeout(client, 30_000));
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).rejects.toThrow(/did not finish startup/);
    // Settle the unused start promise so its handlers don't dangle.
    resolveStart();
  });

  it("rounds odd timeouts to whole seconds in the toast copy", async () => {
    // 1234ms → 1s in the message, not 1.234s — the round-down keeps
    // the toast readable without dropping precision the user cares
    // about (they care about "did it hang", not the exact number).
    const { client } = makeFakeClient();
    const p = armRejectionHandler(startWithTimeout(client, 1_234));
    await vi.advanceTimersByTimeAsync(1_234);
    await expect(p).rejects.toThrow(/within 1s/);
  });

  it("ignores a late start() resolution after the timer has won", async () => {
    // The settled-flag guard is what prevents this. Without it, a
    // tardy start() resolution after the timeout would re-resolve
    // the deferred, but Promise's once-settled invariant means the
    // re-resolution is a no-op; the visible bug would be in
    // intermediate state (stopCalls fired twice, or timer re-armed).
    const fake = makeFakeClient();
    const p = armRejectionHandler(startWithTimeout(fake.client, 30_000));
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).rejects.toThrow();
    // Now start() finally settles. Nothing should change.
    fake.resolveStart();
    // stop() count stays at 1 (the timeout's invocation), not 0.
    expect(fake.stopCalls).toBe(1);
  });
});

describe("formatTimeoutMessage", () => {
  // Exporting the message builder pins the user-facing copy as part
  // of the module's API contract. Future maintainers who reword the
  // toast will trip the test and have to update it deliberately.

  it("mentions the timeout in seconds", () => {
    expect(formatTimeoutMessage(30_000)).toContain("within 30s");
    expect(formatTimeoutMessage(5_000)).toContain("within 5s");
  });

  it("lists the three most likely root causes", () => {
    // Diagnosis breadcrumbs save the maintainer a round trip when a
    // user pastes the toast into an issue. Don't lose them.
    const msg = formatTimeoutMessage(30_000);
    expect(msg).toContain("serverArgs");
    expect(msg).toContain("REPL");
    expect(msg).toContain("pipeline_check install");
  });

  it("points the user at the server log", () => {
    expect(formatTimeoutMessage(30_000)).toContain("server log");
  });

  it("rounds to whole seconds", () => {
    expect(formatTimeoutMessage(1_499)).toContain("within 1s");
    expect(formatTimeoutMessage(1_500)).toContain("within 2s");
  });
});
