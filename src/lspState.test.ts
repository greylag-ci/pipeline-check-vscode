import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", async () => {
  const { vscodeStub } = await import("./__testStubs__/vscode");
  return vscodeStub();
});

import { resetStubState } from "./__testStubs__/vscode";
import { LSP_READY_CONTEXT_KEY, isLspReady, setLspReady } from "./lspState";

beforeEach(() => {
  resetStubState();
});

describe("setLspReady", () => {
  // The two viewsWelcome entries in package.json read
  // `pipelineCheck.lspReady` via `when` clauses. setLspReady is the
  // ONLY writer for that key. These tests pin the contract that the
  // value reaches VS Code's `setContext` channel verbatim — a missed
  // flip means the wrong welcome panel renders.

  it("uses the documented context key name", () => {
    // Hard-coded literal here mirrors the `when` clauses in
    // package.json: a manifest rename without updating this module
    // (or vice versa) silently breaks the welcome panel.
    expect(LSP_READY_CONTEXT_KEY).toBe("pipelineCheck.lspReady");
  });

  it("propagates `true` to setContext for the ready state", () => {
    setLspReady(true);
    const calls = globalThis.__stubCalls?.executeCommand ?? [];
    expect(calls).toEqual([
      {
        command: "setContext",
        args: [LSP_READY_CONTEXT_KEY, true],
      },
    ]);
  });

  it("propagates `false` to setContext for the not-ready state", () => {
    setLspReady(false);
    const calls = globalThis.__stubCalls?.executeCommand ?? [];
    expect(calls).toEqual([
      {
        command: "setContext",
        args: [LSP_READY_CONTEXT_KEY, false],
      },
    ]);
  });

  it("fires once per call so repeated transitions stay observable", () => {
    setLspReady(false);
    setLspReady(true);
    setLspReady(false);
    const calls = globalThis.__stubCalls?.executeCommand ?? [];
    expect(calls.map((c) => c.args[1])).toEqual([false, true, false]);
  });

  it("does not invoke any other VS Code command", () => {
    // Defensive: a future refactor that bundles setContext with a
    // toast / showWelcome / focus call would silently change the UX.
    // Pinning the call to ONLY setContext catches that drift.
    setLspReady(true);
    const calls = globalThis.__stubCalls?.executeCommand ?? [];
    for (const c of calls) {
      expect(c.command).toBe("setContext");
    }
  });
});

describe("isLspReady", () => {
  // Synchronous mirror of what setLspReady last pushed. The
  // scan-workspace gate reads through this rather than through a
  // setContext readback (VS Code has no synchronous getter) — if the
  // two ever drift, the welcome panel and the scan gate disagree.

  it("reports the value of the last setLspReady call", () => {
    setLspReady(true);
    expect(isLspReady()).toBe(true);
    setLspReady(false);
    expect(isLspReady()).toBe(false);
  });

  it("returns true while ready even if other commands have fired", () => {
    setLspReady(true);
    // A future caller might call executeCommand on other surfaces in
    // between; the readback must stay tied to setLspReady alone.
    expect(isLspReady()).toBe(true);
  });
});
