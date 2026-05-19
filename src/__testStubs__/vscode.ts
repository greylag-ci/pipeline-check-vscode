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
// Tests drive behaviour through `globalThis.__stub*` slots and read
// observations back through `globalThis.__stubCalls`. Per-file
// `beforeEach` is expected to reset both. Each slot is documented
// inline below so a new test can find its hook without re-reading the
// whole stub.

export interface StubFindFilesCall {
  readonly include: string;
  readonly exclude?: string;
  readonly maxResults?: number;
}

export interface StubTerminalCall {
  readonly name: string;
  readonly shown: boolean;
  readonly sent: ReadonlyArray<{ readonly text: string; readonly addNewLine: boolean }>;
}

export interface StubExecuteCommandCall {
  readonly command: string;
  readonly args: readonly unknown[];
}

export interface StubClipboardWrite {
  readonly text: string;
}

export interface StubStatusBarMessage {
  readonly text: string;
  readonly hideAfterMs?: number;
}

export interface StubStatusBarItem {
  text: string;
  tooltip: unknown;
  command: unknown;
  name: string;
  backgroundColor: unknown;
  accessibilityInformation: { label: string } | undefined;
  shown: boolean;
  disposed: boolean;
  // Observable counters help tests pin "did update() fire?" without
  // racing against the implementation's debouncing.
  showCount: number;
  hideCount: number;
}

interface StubCalls {
  readonly findFiles: StubFindFilesCall[];
  readonly terminals: StubTerminalCall[];
  readonly executeCommand: StubExecuteCommandCall[];
  readonly clipboardWrites: StubClipboardWrite[];
  readonly statusBarMessages: StubStatusBarMessage[];
  readonly statusBarItems: StubStatusBarItem[];
  readonly infoMessages: string[];
  readonly warningMessages: string[];
  readonly errorMessages: string[];
}

declare global {
  var __stubConfig: Record<string, unknown> | undefined;
  var __stubDiagnostics:
    | Array<[{ toString: () => string }, unknown[]]>
    | undefined;
  // Findings of `findFiles`. Tests may either set a single `__stubFindFiles`
  // (used for every include glob) or `__stubFindFilesByPattern` (a map
  // from include glob → URI list, queried per call).
  var __stubFindFiles: Array<{ toString: () => string; fsPath: string }> | undefined;
  var __stubFindFilesByPattern:
    | Record<string, Array<{ toString: () => string; fsPath: string }>>
    | undefined;
  // What `workspace.workspaceFolders` should return for the duration
  // of a test. `undefined` mimics "no workspace open".
  var __stubWorkspaceFolders:
    | Array<{ uri: { toString: () => string; fsPath: string } }>
    | undefined;
  // URI strings that `openTextDocument` should reject for (simulating
  // a read error / unsupported encoding). All other URIs resolve.
  var __stubOpenTextDocumentFailures: Set<string> | undefined;
  // When true, `withProgress` reports cancellation back to the task
  // immediately. Used by the scanWorkspace cancellation test.
  var __stubProgressCancelled: boolean | undefined;
  var __stubCalls: StubCalls | undefined;
}

function ensureCalls(): StubCalls {
  if (!globalThis.__stubCalls) {
    globalThis.__stubCalls = {
      findFiles: [],
      terminals: [],
      executeCommand: [],
      clipboardWrites: [],
      statusBarMessages: [],
      statusBarItems: [],
      infoMessages: [],
      warningMessages: [],
      errorMessages: [],
    };
  }
  return globalThis.__stubCalls;
}

/**
 * Reset every observable slot in one place. Tests call this in
 * `beforeEach` to keep their assertions isolated. The factory itself
 * does not reset; calling `vscodeStub()` returns a fresh module shape
 * but reuses the global slots so tests across files don't fight.
 */
export function resetStubState(): void {
  globalThis.__stubConfig = {};
  globalThis.__stubDiagnostics = [];
  globalThis.__stubFindFiles = undefined;
  globalThis.__stubFindFilesByPattern = undefined;
  globalThis.__stubWorkspaceFolders = undefined;
  globalThis.__stubOpenTextDocumentFailures = undefined;
  globalThis.__stubProgressCancelled = undefined;
  globalThis.__stubCalls = {
    findFiles: [],
    terminals: [],
    executeCommand: [],
    clipboardWrites: [],
    statusBarMessages: [],
    statusBarItems: [],
    infoMessages: [],
    warningMessages: [],
    errorMessages: [],
  };
}

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
  const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };

  class Range {
    constructor(
      public readonly startLine: number,
      public readonly startCharacter: number,
      public readonly endLine: number,
      public readonly endCharacter: number,
    ) {}
    get start() {
      return { line: this.startLine, character: this.startCharacter };
    }
    get end() {
      return { line: this.endLine, character: this.endCharacter };
    }
  }
  class CodeLens {
    constructor(
      public readonly range: Range,
      public readonly command?: { title: string; command: string },
    ) {}
  }

  return {
    ThemeIcon,
    ThemeColor,
    EventEmitter,
    TreeItem,
    MarkdownString,
    TreeItemCollapsibleState,
    StatusBarAlignment,
    ProgressLocation,
    Range,
    CodeLens,
    Uri,
    workspace: {
      asRelativePath: (uri: { fsPath?: string; path?: string }) =>
        uri.fsPath ?? uri.path ?? "",
      // Getter so a single per-test override (writing to
      // `globalThis.__stubWorkspaceFolders`) reaches the consumer
      // without each test having to mutate the `vscode.workspace`
      // module reference.
      get workspaceFolders() {
        return globalThis.__stubWorkspaceFolders;
      },
      // `getConfiguration(section).get(key, fallback)` reads from
      // `globalThis.__stubConfig`, a `Record<string, unknown>` keyed
      // by `<section>.<key>` (or just `<key>` if no section was
      // passed). Tests set the dictionary in beforeEach so each
      // test's expectations are isolated.
      getConfiguration: (section?: string) => ({
        get: <T>(key: string, fallback?: T): T => {
          const store = globalThis.__stubConfig ?? {};
          const fullKey = section ? `${section}.${key}` : key;
          if (fullKey in store) return store[fullKey] as T;
          return fallback as T;
        },
      }),
      onDidChangeConfiguration: () => ({ dispose: () => undefined }),
      onDidSaveTextDocument: () => ({ dispose: () => undefined }),
      // Resolves with whatever the test stashed on
      // `globalThis.__stubFindFiles` (a flat URI list reused for every
      // include glob) or `globalThis.__stubFindFilesByPattern[include]`
      // (when a per-pattern map is set, more useful for asserting that
      // each pattern is queried separately). Every call is captured on
      // `globalThis.__stubCalls.findFiles` so a test can assert on the
      // include/exclude/maxResults the caller passed.
      findFiles: (include: string, exclude?: string, maxResults?: number) => {
        const calls = ensureCalls();
        calls.findFiles.push({ include, exclude, maxResults });
        const byPattern = globalThis.__stubFindFilesByPattern;
        if (byPattern) {
          return Promise.resolve(byPattern[include] ?? []);
        }
        const flat = globalThis.__stubFindFiles;
        return Promise.resolve(flat ?? []);
      },
      // Resolves with a minimal TextDocument-shaped object for any
      // URI not listed in `__stubOpenTextDocumentFailures`, where it
      // rejects instead. scanWorkspace counts those rejections as
      // `failed` without aborting the rest of the scan.
      openTextDocument: (uri: { toString: () => string }) => {
        const key = uri.toString();
        if (globalThis.__stubOpenTextDocumentFailures?.has(key)) {
          return Promise.reject(new Error(`stub: open failed for ${key}`));
        }
        return Promise.resolve({ uri });
      },
    },
    languages: {
      // Two call shapes:
      //   - `getDiagnostics()` returns every [uri, diagnostic[]] pair
      //   - `getDiagnostics(uri)` returns just that uri's diagnostics
      getDiagnostics: (uri?: { toString: () => string }) => {
        const all = globalThis.__stubDiagnostics ?? [];
        if (uri === undefined) return all;
        const key = uri.toString();
        const match = all.find(([u]) => u.toString() === key);
        return match ? match[1] : [];
      },
      onDidChangeDiagnostics: () => ({ dispose: () => undefined }),
    },
    commands: {
      // Captures every executeCommand invocation on the shared
      // `__stubCalls.executeCommand` slot. Tests assert on the call
      // history (e.g. setContext / pipelineCheck.lspReady / true).
      executeCommand: (command: string, ...args: unknown[]) => {
        ensureCalls().executeCommand.push({ command, args });
        return Promise.resolve();
      },
      registerCommand: () => ({ dispose: () => undefined }),
    },
    env: {
      clipboard: {
        writeText: (text: string) => {
          ensureCalls().clipboardWrites.push({ text });
          return Promise.resolve();
        },
      },
      openExternal: () => Promise.resolve(true),
    },
    window: {
      // Terminal factory captures the name and returns a stub whose
      // show/sendText calls land on the shared slot. Each call returns
      // a fresh terminal with its own observation buffer.
      createTerminal: (name: string) => {
        const sent: Array<{ text: string; addNewLine: boolean }> = [];
        const record = {
          name,
          shown: false,
          sent,
        };
        ensureCalls().terminals.push(record);
        return {
          name,
          show: () => {
            // Mutate the captured record so tests see `shown: true`
            // without having to drill into a closure.
            (record as { shown: boolean }).shown = true;
          },
          sendText: (text: string, addNewLine?: boolean) => {
            sent.push({ text, addNewLine: addNewLine ?? true });
          },
          dispose: () => undefined,
        };
      },
      createStatusBarItem: (
        _alignment?: number,
        _priority?: number,
      ): StubStatusBarItem & {
        show: () => void;
        hide: () => void;
        dispose: () => void;
      } => {
        const item: StubStatusBarItem & {
          show: () => void;
          hide: () => void;
          dispose: () => void;
        } = {
          text: "",
          tooltip: undefined,
          command: undefined,
          name: "",
          backgroundColor: undefined,
          accessibilityInformation: undefined,
          shown: false,
          disposed: false,
          showCount: 0,
          hideCount: 0,
          show() {
            this.shown = true;
            this.showCount += 1;
          },
          hide() {
            this.shown = false;
            this.hideCount += 1;
          },
          dispose() {
            this.disposed = true;
          },
        };
        ensureCalls().statusBarItems.push(item);
        return item;
      },
      setStatusBarMessage: (text: string, hideAfterMs?: number) => {
        ensureCalls().statusBarMessages.push({ text, hideAfterMs });
        return { dispose: () => undefined };
      },
      showInformationMessage: (message: string) => {
        ensureCalls().infoMessages.push(message);
        return Promise.resolve(undefined);
      },
      showWarningMessage: (message: string) => {
        ensureCalls().warningMessages.push(message);
        return Promise.resolve(undefined);
      },
      showErrorMessage: (message: string) => {
        ensureCalls().errorMessages.push(message);
        return Promise.resolve(undefined);
      },
      // Progress UI: invokes the task immediately with a no-op
      // `progress` reporter and a never-cancelled token. Good enough
      // to drive scanWorkspace's loop in a unit test without mocking
      // out the full Progress API surface.
      withProgress: async <T>(
        _options: unknown,
        task: (
          progress: { report: (value: unknown) => void },
          token: { isCancellationRequested: boolean },
        ) => Thenable<T>,
      ): Promise<T> => {
        const progress = { report: () => undefined };
        const token = {
          get isCancellationRequested() {
            return globalThis.__stubProgressCancelled === true;
          },
        };
        return task(progress, token);
      },
    },
  };
}
