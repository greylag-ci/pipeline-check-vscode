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
  // depend on it being exactly `pip install "pipeline-check[lsp]"`.
  // Test failures here are intentional friction: an accidental rename
  // (or missing quoting around the extra) should fail loudly.
  it("is the canonical PyPI install line, with the [lsp] extra quoted", () => {
    expect(PIP_INSTALL_COMMAND).toBe('pip install "pipeline-check[lsp]"');
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
