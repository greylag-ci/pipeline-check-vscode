import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", () => ({}));

import {
  formatTimestamp,
  info,
  warn,
  error,
  setLogChannel,
  withTiming,
} from "./log";

// Capture log lines by passing a fake OutputChannel.
function fakeChannel() {
  const lines: string[] = [];
  return {
    lines,
    channel: {
      appendLine: (s: string) => {
        lines.push(s);
      },
      // Methods we don't exercise; provided so the type satisfies
      // vscode.OutputChannel's minimal shape.
      name: "Pipeline-Check",
      append: () => undefined,
      clear: () => undefined,
      show: () => undefined,
      hide: () => undefined,
      replace: () => undefined,
      dispose: () => undefined,
    } as unknown as import("vscode").OutputChannel,
  };
}

beforeEach(() => {
  // Reset the module-scope channel so a test that doesn't call
  // setLogChannel can verify the no-op path.
  setLogChannel(
    undefined as unknown as import("vscode").OutputChannel,
  );
});

describe("formatTimestamp", () => {
  it("zero-pads the components", () => {
    const d = new Date(2026, 0, 1, 3, 4, 5, 6);
    expect(formatTimestamp(d)).toBe("03:04:05.006");
  });

  it("uses millisecond precision", () => {
    const d = new Date(2026, 0, 1, 23, 59, 59, 999);
    expect(formatTimestamp(d)).toBe("23:59:59.999");
  });
});

describe("log levels", () => {
  it("info appends a line with the [client] prefix and level", () => {
    const { lines, channel } = fakeChannel();
    setLogChannel(channel);
    info("hello");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[client]");
    expect(lines[0]).toContain("info");
    expect(lines[0]).toContain("hello");
  });

  it("warn level is preserved", () => {
    const { lines, channel } = fakeChannel();
    setLogChannel(channel);
    warn("careful");
    expect(lines[0]).toContain("warn");
  });

  it("error level is preserved", () => {
    const { lines, channel } = fakeChannel();
    setLogChannel(channel);
    error("oops");
    expect(lines[0]).toContain("error");
  });

  it("is a no-op before setLogChannel has been called", () => {
    // setLogChannel was reset to undefined in beforeEach.
    expect(() => info("nowhere to go")).not.toThrow();
  });
});

describe("withTiming", () => {
  it("logs start, ok, and the elapsed milliseconds on success", async () => {
    const { lines, channel } = fakeChannel();
    setLogChannel(channel);
    await withTiming("test op", async () => undefined);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/test op: start$/);
    expect(lines[1]).toMatch(/test op: ok in \d+ms$/);
  });

  it("logs failure and re-throws the original error", async () => {
    const { lines, channel } = fakeChannel();
    setLogChannel(channel);
    await expect(
      withTiming("doomed", async () => {
        throw new Error("kaboom");
      }),
    ).rejects.toThrow("kaboom");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("doomed: failed");
    expect(lines[1]).toContain("kaboom");
  });
});
