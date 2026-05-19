// Shared `vscode` module stub for the vitest suite. Each test file
// registers it via:
//
//     vi.mock("vscode", async () => {
//       const { vscodeStub } = await import("./__testStubs__/vscode");
//       return vscodeStub();
//     });
//
// `vi.mock` factories are hoisted above imports and must self-contain,
// so the async-import pattern is the only safe way to share. Returning
// a fresh object per call keeps tests isolated — none of the classes
// or stubs leak state between files.
//
// `getDiagnostics` reads from `globalThis.__stubDiagnostics`, which
// tests populate via the per-file `setStubDiagnostics` helper they
// keep close to their fixtures.

export function vscodeStub(): Record<string, unknown> {
  class ThemeIcon {
    constructor(
      public readonly id: string,
      public readonly color?: ThemeColor,
    ) {}
  }
  class ThemeColor {
    constructor(public readonly id: string) {}
  }
  class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    fire(e: T): void {
      for (const l of this.listeners) l(e);
    }
    get event() {
      return (listener: (e: T) => void) => {
        this.listeners.push(listener);
        return { dispose: () => undefined };
      };
    }
    dispose(): void {
      this.listeners = [];
    }
  }
  class TreeItem {
    iconPath?: unknown;
    description?: string;
    tooltip?: unknown;
    command?: unknown;
    contextValue?: string;
    constructor(
      public readonly label: string,
      public readonly collapsibleState: number,
    ) {}
  }
  class MarkdownString {
    isTrusted = false;
    supportThemeIcons = false;
    constructor(public value: string) {}
    appendMarkdown(s: string): this {
      this.value += s;
      return this;
    }
  }
  const Uri = {
    parse: (s: string) => {
      const noScheme = s.replace(/^file:\/\//, "");
      return {
        toString: () => s,
        path: noScheme,
        fsPath: noScheme,
      };
    },
  };
  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
  const StatusBarAlignment = { Left: 1, Right: 2 };

  return {
    ThemeIcon,
    ThemeColor,
    EventEmitter,
    TreeItem,
    MarkdownString,
    TreeItemCollapsibleState,
    StatusBarAlignment,
    Uri,
    workspace: {
      asRelativePath: (uri: { fsPath?: string; path?: string }) =>
        uri.fsPath ?? uri.path ?? "",
    },
    languages: {
      // Two call shapes:
      //   - `getDiagnostics()` returns every [uri, diagnostic[]] pair
      //   - `getDiagnostics(uri)` returns just that uri's diagnostics
      getDiagnostics: (uri?: { toString: () => string }) => {
        const all =
          (
            globalThis as {
              __stubDiagnostics?: Array<[
                { toString: () => string },
                unknown[],
              ]>;
            }
          ).__stubDiagnostics ?? [];
        if (uri === undefined) return all;
        const key = uri.toString();
        const match = all.find(([u]) => u.toString() === key);
        return match ? match[1] : [];
      },
      onDidChangeDiagnostics: () => ({ dispose: () => undefined }),
    },
    commands: { executeCommand: () => Promise.resolve() },
    window: {},
  };
}
