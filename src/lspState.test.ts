import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", async () => {
  const { vscodeStub } = await import("./__testStubs__/vscode");
  return vscodeStub();
});

import { resetStubState } from "./__testStubs__/vscode";
import {
  ENGINE_OUT_OF_DATE_CONTEXT_KEY,
  LSP_READY_CONTEXT_KEY,
  isEngineOutOfDate,
  isLspReady,
  setEngineOutOfDate,
  setLspReady,
} from "./lspState";

beforeEach(() => {
  resetStubState();
  // Reset module-level state between tests so a setLspReady(true) in
  // one test doesn't leak the truthy-clear behaviour into the next.
  setLspReady(false);
  setEngineOutOfDate(false);
  // Drain the setContext history caused by the reset above so each
  // test asserts only on the calls IT made.
  if (globalThis.__stubCalls) {
    globalThis.__stubCalls.executeCommand.length = 0;
  }
});

// Helper: filter the captured setContext calls down to a single key
// so each test can assert against just the surface it cares about.
function setContextCallsFor(key: string): boolean[] {
  const calls = globalThis.__stubCalls?.executeCommand ?? [];
  return calls
    .filter((c) => c.command === "setContext" && c.args[0] === key)
    .map((c) => c.args[1] as boolean);
}

describe("setLspReady", () => {
  // The viewsWelcome entries in package.json read
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
    expect(setContextCallsFor(LSP_READY_CONTEXT_KEY)).toEqual([true]);
  });

  it("propagates `false` to setContext for the not-ready state", () => {
    setLspReady(false);
    expect(setContextCallsFor(LSP_READY_CONTEXT_KEY)).toEqual([false]);
  });

  it("fires once per call so repeated transitions stay observable", () => {
    setLspReady(false);
    setLspReady(true);
    setLspReady(false);
    expect(setContextCallsFor(LSP_READY_CONTEXT_KEY)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("uses only setContext (no other VS Code commands)", () => {
    // Defensive: a future refactor that bundles setContext with a
    // toast / showWelcome / focus call would silently change the UX.
    // Pinning the call to ONLY setContext catches that drift.
    setLspReady(true);
    const calls = globalThis.__stubCalls?.executeCommand ?? [];
    for (const c of calls) {
      expect(c.command).toBe("setContext");
    }
  });

  it("clears engineOutOfDate when transitioning to ready", () => {
    // A successful start means we're definitely not in the
    // out-of-date state — clear the welcome-panel context key so the
    // upgrade-prompt panel doesn't outlive the condition that fired
    // it. Without this clear, a user who fixed the engine via the
    // toast's Upgrade flow and clicked Restart would still see the
    // upgrade prompt under the now-ready editor.
    setEngineOutOfDate(true);
    setLspReady(true);
    // The most recent setContext for engineOutOfDate must be `false`.
    const calls = setContextCallsFor(ENGINE_OUT_OF_DATE_CONTEXT_KEY);
    expect(calls[calls.length - 1]).toBe(false);
    expect(isEngineOutOfDate()).toBe(false);
  });

  it("leaves engineOutOfDate untouched when transitioning to not-ready", () => {
    // The inverse must NOT clear — if startClient flips lspReady to
    // false BECAUSE the engine is out of date, the upgrade-prompt
    // panel needs to stay visible. The truthy-clear branch was
    // explicit guard against that regression.
    setEngineOutOfDate(true);
    // Drain the setContext history so the assertion isolates the
    // setLspReady(false) effect from the prior setEngineOutOfDate(true).
    globalThis.__stubCalls!.executeCommand.length = 0;
    setLspReady(false);
    expect(setContextCallsFor(ENGINE_OUT_OF_DATE_CONTEXT_KEY)).toEqual([]);
    expect(isEngineOutOfDate()).toBe(true);
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

describe("setEngineOutOfDate", () => {
  // Mirrors setLspReady's contract — single setContext write per
  // call, synchronous readback via isEngineOutOfDate. The welcome
  // panel's upgrade-prompt entry reads this key.

  it("uses the documented context key name", () => {
    expect(ENGINE_OUT_OF_DATE_CONTEXT_KEY).toBe(
      "pipelineCheck.engineOutOfDate",
    );
  });

  it("propagates the value to setContext", () => {
    setEngineOutOfDate(true);
    setEngineOutOfDate(false);
    expect(setContextCallsFor(ENGINE_OUT_OF_DATE_CONTEXT_KEY)).toEqual([
      true,
      false,
    ]);
  });

  it("isEngineOutOfDate mirrors the last write", () => {
    expect(isEngineOutOfDate()).toBe(false);
    setEngineOutOfDate(true);
    expect(isEngineOutOfDate()).toBe(true);
    setEngineOutOfDate(false);
    expect(isEngineOutOfDate()).toBe(false);
  });
});

describe("welcome-panel state machine transitions", () => {
  // The three welcome-panel entries in package.json are gated by:
  //   - pipelineCheck.lspReady                                          (ready  → Scan workspace)
  //   - pipelineCheck.engineOutOfDate                                   (out_of_date → Upgrade)
  //   - !pipelineCheck.lspReady && !pipelineCheck.engineOutOfDate       (missing → Install)
  //
  // The setter behaviour must keep the three states mutually exclusive
  // for VS Code's `when:` evaluation. These end-to-end tests pin the
  // observed (lspReady, engineOutOfDate) pair after each realistic
  // transition the extension makes during a session.

  function state(): { ready: boolean; outOfDate: boolean } {
    return { ready: isLspReady(), outOfDate: isEngineOutOfDate() };
  }

  it("cold start with missing engine: install-prompt is the only true state", () => {
    // startClient → preflight fails with reason='missing'
    //            → setEngineOutOfDate(false), setLspReady stays false.
    setLspReady(false);
    setEngineOutOfDate(false);
    expect(state()).toEqual({ ready: false, outOfDate: false });
  });

  it("cold start with out-of-date engine: upgrade-prompt becomes the active state", () => {
    // startClient → preflight fails with reason='out_of_date'
    //            → setEngineOutOfDate(true), setLspReady stays false.
    // Welcome panel: !lspReady && !engineOutOfDate is FALSE,
    // engineOutOfDate is TRUE → upgrade entry shows.
    setEngineOutOfDate(true);
    expect(state()).toEqual({ ready: false, outOfDate: true });
  });

  it("user clicks Upgrade, fixes engine, clicks Restart, start succeeds: ready becomes the only true state", () => {
    // startClient (success after upgrade) → setLspReady(true), which
    // ALSO clears engineOutOfDate as a defensive guard.
    setEngineOutOfDate(true);
    expect(state()).toEqual({ ready: false, outOfDate: true });
    setLspReady(true);
    expect(state()).toEqual({ ready: true, outOfDate: false });
  });

  it("LSP crashes mid-session: ready clears but engineOutOfDate stays false (not the cause)", () => {
    // State.Stopped listener fires setLspReady(false). The crash
    // wasn't an out-of-date detection so engineOutOfDate stays false.
    // Welcome panel falls back to install-prompt (best we can do
    // without further info — restart will re-preflight).
    setLspReady(true);
    expect(state()).toEqual({ ready: true, outOfDate: false });
    setLspReady(false);
    expect(state()).toEqual({ ready: false, outOfDate: false });
  });

  it("stopClient resets both to false (clean slate for the next start)", () => {
    // stopClient calls setLspReady(false) and setEngineOutOfDate(false)
    // — the welcome panel returns to install-prompt regardless of
    // what state we were in before the stop.
    setEngineOutOfDate(true);
    setLspReady(false);
    expect(state()).toEqual({ ready: false, outOfDate: true });
    setEngineOutOfDate(false);
    expect(state()).toEqual({ ready: false, outOfDate: false });
  });

  it("never lands in (ready=true, outOfDate=true) — the impossible state", () => {
    // The truthy-clear in setLspReady is what guarantees this. If a
    // future refactor strips the clear, the welcome panel would
    // render two banners simultaneously. Belt + braces test.
    setEngineOutOfDate(true);
    setLspReady(true);
    expect(state().ready && state().outOfDate).toBe(false);
  });
});
