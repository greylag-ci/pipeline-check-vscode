import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", async () => {
  const { vscodeStub } = await import("./__testStubs__/vscode");
  return vscodeStub();
});

import { resetStubState } from "./__testStubs__/vscode";
import {
  PIP_INSTALL_COMMAND,
  copyInstallCommandToClipboard,
  installInTerminal,
} from "./install";

beforeEach(() => {
  resetStubState();
});

describe("PIP_INSTALL_COMMAND", () => {
  // The literal string is the contract — UI surfaces (welcome panel,
  // failure toast, copy command) and the terminal-install path all
  // depend on it. Test failures here are intentional friction: an
  // accidental rename (or missing quoting around the extra) should
  // fail loudly.

  it("is the canonical PyPA `python -m pip` install line, with the [lsp] extra quoted", () => {
    expect(PIP_INSTALL_COMMAND).toBe(
      'python -m pip install "pipeline-check[lsp]"',
    );
  });

  it("invokes pip via the python interpreter (NOT the bare `pip` shim)", () => {
    // The `python -m pip` form is what dodges PowerShell
    // ExecutionPolicy blocking pip.exe AND the "no pip on PATH"
    // case when only python is installed. A regression to
    // `pip install ...` reintroduces both failure modes on Windows.
    expect(PIP_INSTALL_COMMAND.startsWith("python -m pip ")).toBe(true);
    expect(PIP_INSTALL_COMMAND.startsWith("pip ")).toBe(false);
  });

  it("targets the [lsp] extra (not the base package)", () => {
    // Without the [lsp] extra the LSP server module isn't installed
    // and the extension still can't start. Lock the extra in.
    expect(PIP_INSTALL_COMMAND).toContain('"pipeline-check[lsp]"');
  });
});

describe("installInTerminal", () => {
  it("creates a new terminal with the Pipeline-Check name", () => {
    installInTerminal();
    const terminals = globalThis.__stubCalls?.terminals ?? [];
    expect(terminals).toHaveLength(1);
    expect(terminals[0].name).toBe("Pipeline-Check install");
  });

  it("focuses the new terminal so the command is visible", () => {
    installInTerminal();
    const terminals = globalThis.__stubCalls?.terminals ?? [];
    expect(terminals[0].shown).toBe(true);
  });

  it("types the pip command without auto-executing (addNewLine=false)", () => {
    // This is the load-bearing invariant: a user with an unactivated
    // venv must see the command, NOT run it. Asserting addNewLine ===
    // false pins the safer behaviour.
    installInTerminal();
    const t = globalThis.__stubCalls!.terminals[0];
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].text).toBe(PIP_INSTALL_COMMAND);
    expect(t.sent[0].addNewLine).toBe(false);
  });

  it("never sends a second line — one command, end of story", () => {
    installInTerminal();
    const t = globalThis.__stubCalls!.terminals[0];
    expect(t.sent).toHaveLength(1);
  });

  it("does not write to the clipboard (separate code path)", () => {
    installInTerminal();
    expect(globalThis.__stubCalls?.clipboardWrites).toEqual([]);
  });

  it("reuses the existing 'Pipeline-Check install' terminal on a second call", () => {
    // A user who clicks "Install in terminal" twice — once from the
    // welcome panel, then again from the LSP-failure toast — used to
    // get two identical terminals stacked in the dropdown. Now the
    // second call surfaces the same terminal. The createTerminal
    // call count is the canonical assertion.
    const first = installInTerminal();
    const second = installInTerminal();
    expect(second).toBe(first);
    expect(globalThis.__stubCalls?.terminals).toHaveLength(1);
  });

  it("the reused terminal still gets show() + sendText() so it's visible and primed", () => {
    installInTerminal();
    installInTerminal();
    const t = globalThis.__stubCalls!.terminals[0];
    expect(t.shown).toBe(true);
    // sendText fired twice (once per call); the same command text.
    expect(t.sent).toHaveLength(2);
    expect(t.sent[0].text).toBe(PIP_INSTALL_COMMAND);
    expect(t.sent[1].text).toBe(PIP_INSTALL_COMMAND);
  });

  it("treats an exited terminal as dead and creates a fresh one", () => {
    // A user closed the prior install terminal after running pip,
    // then triggered the install again. Reusing the dead terminal
    // would silently fail (sendText is a no-op on an exited
    // pty); a fresh one is the right answer.
    const first = installInTerminal();
    // Simulate the user closing the terminal: mark the live entry
    // as exited.
    const live = globalThis.__stubLiveTerminals?.[0];
    if (live) live.exitStatus = { code: 0 };
    const second = installInTerminal();
    expect(second).not.toBe(first);
    expect(globalThis.__stubCalls?.terminals).toHaveLength(2);
  });

  it("ignores other terminals whose name differs", () => {
    // A user's `bash` / `python REPL` terminal must not be hijacked
    // by the install command. Only terminals named exactly
    // 'Pipeline-Check install' qualify for reuse.
    // Pre-populate the live roster with a same-named-but-foreign
    // terminal... actually the simpler check: a foreign terminal
    // with a different name must not be reused.
    globalThis.__stubLiveTerminals = [
      {
        name: "bash",
        exitStatus: undefined,
        show: () => undefined,
        sendText: () => undefined,
        dispose: () => undefined,
      },
    ];
    installInTerminal();
    // createTerminal was called (because the bash terminal didn't
    // match by name), and the resulting terminal is the one we just
    // sent the command to.
    const terminals = globalThis.__stubCalls?.terminals ?? [];
    expect(terminals).toHaveLength(1);
    expect(terminals[0].name).toBe("Pipeline-Check install");
  });
});

describe("copyInstallCommandToClipboard", () => {
  it("writes exactly the pip command to the clipboard", async () => {
    await copyInstallCommandToClipboard();
    expect(globalThis.__stubCalls?.clipboardWrites).toEqual([
      { text: PIP_INSTALL_COMMAND },
    ]);
  });

  it("surfaces a status-bar confirmation so the silent copy is visible", async () => {
    await copyInstallCommandToClipboard();
    const messages = globalThis.__stubCalls?.statusBarMessages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain(PIP_INSTALL_COMMAND);
    expect(messages[0].text.toLowerCase()).toContain("copied");
  });

  it("expires the status-bar confirmation after a short TTL (a few seconds)", async () => {
    // The TTL is a UX detail (long enough to read, short enough not
    // to stick around). Bound the assertion loosely — anything between
    // a perceptible flash (1s) and an over-stay (10s) is fine.
    await copyInstallCommandToClipboard();
    const ttl =
      globalThis.__stubCalls?.statusBarMessages[0]?.hideAfterMs ?? 0;
    expect(ttl).toBeGreaterThanOrEqual(1000);
    expect(ttl).toBeLessThanOrEqual(10000);
  });

  it("never opens a terminal (separate code path)", async () => {
    await copyInstallCommandToClipboard();
    expect(globalThis.__stubCalls?.terminals).toEqual([]);
  });
});
