// Entry point for the Pipeline-Check VS Code extension.
//
// All this client does is spawn `python -m pipeline_check.lsp` over stdio
// and bridge it to VS Code's LanguageClient. Every rule decision, every
// hover prose string, and every diagnostic comes from the Python server
// — the TypeScript side stays a thin transport adapter so the editor
// findings match `pipeline_check --output json` byte-for-byte (modulo
// position translation).
//
// The server itself lives upstream in `dmartinochoa/pipeline-check`
// under `pipeline_check/lsp/`; install via `pip install
// "pipeline-check[lsp]"`.

import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { FindingsCodeLensProvider } from "./codeLens";
import { FindingsTreeProvider, GroupMode } from "./findingsView";
import * as clientLog from "./log";
import { goToFinding } from "./navigate";
import {
  providerForPath,
  type ProviderId,
  TRIGGER_DOCUMENT_SELECTOR,
} from "./providers";
import { filterByThreshold } from "./severityFilter";
import { registerStatusBar } from "./statusBar";
import { scanWorkspace } from "./workspaceScan";
import { showWhatsNewIfUpgraded } from "./whatsNew";

// Group-mode options offered by the Findings panel's "Change
// Grouping" button. Labels are user-facing; descriptions are the
// muted secondary text in the Quick Pick row. The order matches the
// title-bar history of the radio buttons that this Quick Pick
// replaces, so muscle memory carries over.
const GROUPING_PICKS: readonly {
  readonly mode: GroupMode;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    mode: "severity",
    label: "Severity",
    description: "Critical, High, Medium, Low, Info",
  },
  {
    mode: "file",
    label: "File",
    description: "One bucket per file, ordered by path",
  },
  {
    mode: "rule",
    label: "Rule",
    description: "One bucket per check ID (GHA-001, etc.)",
  },
];

async function changeGrouping(
  provider: FindingsTreeProvider,
): Promise<void> {
  const current = provider.getGroupMode();
  type Pick = vscode.QuickPickItem & { mode: GroupMode };
  const items: Pick[] = GROUPING_PICKS.map((p) => ({
    // ``$(check)`` prefix marks the active mode. The Quick Pick has
    // no native "selected option" affordance for show-only-callback
    // pickers, so we draw the check ourselves — same pattern VS Code
    // uses for its "Change Language Mode" picker.
    label: p.mode === current ? `$(check) ${p.label}` : `    ${p.label}`,
    description: p.description,
    mode: p.mode,
  }));
  const choice = await vscode.window.showQuickPick(items, {
    title: "Group findings by",
    placeHolder: "Choose how the panel should bucket findings",
  });
  if (choice) {
    provider.setGroupMode(choice.mode);
  }
}
const LANGUAGE_ID = "pipelineCheck";
const LANGUAGE_NAME = "Pipeline-Check";
const OUTPUT_CHANNEL = "Pipeline-Check";

// `setStatusBarMessage` TTL for transient confirmations (clipboard
// writes, etc.). Two seconds is long enough to be readable and short
// enough that a stream of copies doesn't pile up.
const CONFIRM_TTL_MS = 2000;

// Structural shape of a Findings-tree leaf node, used by the
// context-menu commands. The real LeafNode lives in findingsView.ts;
// duplicating just the fields the commands read keeps extension.ts
// independent of the tree's internal type definitions.
type LeafLike = {
  readonly finding?: {
    readonly ruleId?: string;
    readonly docsUrl?: string;
    readonly uri?: vscode.Uri;
    readonly diagnostic?: { readonly range?: vscode.Range };
  };
};

let client: LanguageClient | undefined;

function buildClient(): LanguageClient {
  const config = vscode.workspace.getConfiguration("pipelineCheck");
  const command = config.get<string>("serverCommand", "python");
  const args = config.get<string[]>("serverArgs", ["-m", "pipeline_check.lsp"]);

  const serverOptions: ServerOptions = {
    run: { command, args, transport: TransportKind.stdio },
    debug: { command, args, transport: TransportKind.stdio },
  };

  // Match by path glob instead of language ID. Language-based selectors
  // would let unrelated YAML files (mkdocs.yml, Helm `values.yaml`,
  // package.json, etc.) reach the LSP and rely on the server's
  // content-and-path filter to bounce them. Path-based selectors keep
  // that filter as a backstop but hand the server only candidate files
  // in the first place — smaller cross-section, no dependency on whether
  // the user has the official GitHub Actions extension installed
  // (which would otherwise hijack the `github-actions-workflow`
  // language ID for `.github/workflows/*.yml`). The pattern list itself
  // lives in providers.ts so the documentSelector, activationEvents,
  // and the workspace-scan command can't drift apart.
  const clientOptions: LanguageClientOptions = {
    documentSelector: [...TRIGGER_DOCUMENT_SELECTOR],
    synchronize: {
      configurationSection: "pipelineCheck",
    },
    outputChannelName: OUTPUT_CHANNEL,
    middleware: {
      // Drop diagnostics below the user-configured severity threshold
      // before they reach VS Code's Problems panel. The config is
      // re-read on each publish so a settings change takes effect on
      // the next scan without needing a server restart. Diagnostics
      // whose `data.severity` is missing (older server, or a
      // not-from-pipeline-check publish that somehow flowed through)
      // pass through unconditionally so the filter never hides
      // legitimate signal when the metadata is absent.
      handleDiagnostics: (uri, diagnostics, next) => {
        const config = vscode.workspace.getConfiguration("pipelineCheck");
        // Per-provider toggle: if this URI maps to a provider the
        // user has disabled, drop every diagnostic for it. We still
        // accept the publish (so a future "unset disable" causes a
        // fresh publish to reach us), we just blank the list.
        const disabled = new Set(
          config.get<string[]>("disabledProviders", []) as ProviderId[],
        );
        const provider = providerForPath(uri.fsPath);
        if (provider && disabled.has(provider)) {
          next(uri, []);
          return;
        }
        const threshold = config.get<string>("severityThreshold", "low");
        next(uri, filterByThreshold(diagnostics, threshold));
      },
    },
  };

  return new LanguageClient(
    LANGUAGE_ID,
    LANGUAGE_NAME,
    serverOptions,
    clientOptions,
  );
}

async function startClient(): Promise<void> {
  if (client) {
    // Bail without restart-loops if someone double-fires the activation
    // event. The restart command goes through stopClient first, so
    // this guard is the genuinely-duplicate case.
    return;
  }
  client = buildClient();
  // The output channel is created by LanguageClient as a side effect of
  // construction, so it is always present here. Capture it before we
  // drop the broken client on failure (the "Open server log" action
  // below still needs to focus it to surface the server's traceback).
  const outputChannel: vscode.OutputChannel = client.outputChannel;
  // Point the client-side logger at the same channel the LSP server
  // writes to, so [client] and [server] lines interleave with shared
  // timestamps — much easier to read when triaging a bug report.
  clientLog.setLogChannel(outputChannel);
  try {
    clientLog.info("language server: starting");
    await client.start();
    clientLog.info("language server: started");
  } catch (err) {
    // The most common cause is `python -m pipeline_check.lsp` failing:
    // either Python is not on PATH or the [lsp] extra is not installed.
    // Surface the install command and the server log as two distinct
    // actions so the user can act on either without re-reading the
    // notification body. The notification chrome already shows the
    // extension name, so the message body doesn't repeat it.
    //
    // The notification is fire-and-forget: `showErrorMessage` resolves
    // only when the user clicks a button or closes the toast, and
    // `activate()` already awaits this path. Awaiting here would block
    // activation indefinitely whenever nobody is around to click
    // (CI, automation, headless extension host). Detaching keeps the
    // user's buttons live while letting startClient return.
    const message = err instanceof Error ? err.message : String(err);
    clientLog.error(`language server: failed to start — ${message}`);
    void vscode.window
      .showErrorMessage(
        `Language server failed to start (${message}).`,
        "Copy install command",
        "Open server log",
      )
      .then(async (choice) => {
        if (choice === "Copy install command") {
          await vscode.env.clipboard.writeText(
            'pip install "pipeline-check[lsp]"',
          );
          vscode.window.setStatusBarMessage(
            'Copied: pip install "pipeline-check[lsp]"',
            CONFIRM_TTL_MS,
          );
        } else if (choice === "Open server log") {
          outputChannel.show();
        }
      });
    // Drop the broken client so a subsequent restart starts fresh
    // rather than trying to recover from a half-initialised state.
    client = undefined;
  }
}

// Hard ceiling on how long deactivate / restart waits for the LSP
// child to shut down cleanly. A deadlocked server would otherwise
// hold the deactivate path indefinitely and VS Code reports "Window
// not responding".
const STOP_TIMEOUT_MS = 2000;

async function stopClient(): Promise<void> {
  if (!client) {
    return;
  }
  const local = client;
  client = undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      local.stop(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    // If stop() didn't win the race the client is stranded; dispose
    // explicitly so its subscriptions don't outlive us.
    local.dispose?.();
  }
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // The Findings tree reads from already-published diagnostics, so we
  // wire it up before starting the client. That way, if the server
  // takes a moment to come up (or fails outright), the panel is still
  // visible and surfaces findings the moment the first publish lands.
  const findingsProvider = new FindingsTreeProvider(context);
  const findingsView = vscode.window.createTreeView("pipelineCheck.findings", {
    treeDataProvider: findingsProvider,
    showCollapseAll: true,
  });
  // Two-phase wiring: the view needs the provider at construction
  // time, but the provider needs the view to drive its activity-bar
  // badge. Handing the view back closes the loop and triggers an
  // initial badge update.
  findingsProvider.setTreeView(findingsView);
  // Status bar item lives at the bottom-left and shows the per-
  // severity tally. Click reveals the Findings panel. registerStatusBar
  // pushes the item onto context.subscriptions internally.
  registerStatusBar(context);
  // CodeLens summary at the top of every scanned file. Reads from the
  // same diagnostic stream the tree does; click navigates to the
  // Findings panel for drill-down.
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [...TRIGGER_DOCUMENT_SELECTOR],
      new FindingsCodeLensProvider(context),
    ),
  );
  context.subscriptions.push(
    findingsView,
    // Workspace scan: open every candidate file so the LSP runs its
    // didOpen pipeline on each. Findings panel updates as the server
    // publishes; no extra state to manage.
    vscode.commands.registerCommand("pipelineCheck.scanWorkspace", () =>
      scanWorkspace(),
    ),
    // "Refresh Findings" was historically a tree-only re-render. Now
    // that we have a real scan command, refresh runs an actual scan so
    // the button matches the user's mental model — clicking "refresh"
    // should fetch fresh data, not re-paint stale data. The tree
    // updates automatically as scan publishes arrive (R10).
    vscode.commands.registerCommand("pipelineCheck.findings.refresh", () =>
      scanWorkspace(),
    ),
    vscode.commands.registerCommand(
      "pipelineCheck.findings.changeGrouping",
      () => changeGrouping(findingsProvider),
    ),
    // Context-menu entries on a Findings tree leaf. VS Code passes the
    // TreeNode as the first argument; we read the `finding` shape off
    // it. Both commands are gated behind `viewItem == pipelineCheck.finding`
    // in package.json so the node is always a leaf when these fire.
    vscode.commands.registerCommand(
      "pipelineCheck.findings.copyRuleId",
      async (node: LeafLike | undefined) => {
        const id = node?.finding?.ruleId?.trim();
        if (!id) {
          void vscode.window.showInformationMessage(
            "Pipeline-Check: this finding has no rule ID.",
          );
          return;
        }
        await vscode.env.clipboard.writeText(id);
        // Status-bar message instead of a modal toast — the copy
        // succeeded silently 95% of the time anyway; this is a
        // ~2-second confirmation that doesn't steal focus.
        vscode.window.setStatusBarMessage(`Copied ${id}`, CONFIRM_TTL_MS);
      },
    ),
    vscode.commands.registerCommand(
      "pipelineCheck.findings.openRuleDocs",
      async (node: LeafLike | undefined) => {
        const url = node?.finding?.docsUrl?.trim();
        if (!url) {
          void vscode.window.showInformationMessage(
            "Pipeline-Check: no documentation URL was published for this rule.",
          );
          return;
        }
        await vscode.env.openExternal(vscode.Uri.parse(url));
      },
    ),
    // Open a finding without using the editor's preview-tab slot.
    // Same target as the default click-to-reveal, but `preview: false`
    // pins each opened file as a permanent tab — useful when the user
    // is opening several findings side-by-side. Lives only in the
    // leaf context menu; the single-click path stays preview-style so
    // the common "click through findings to triage" flow doesn't
    // create tab clutter.
    vscode.commands.registerCommand(
      "pipelineCheck.findings.openNonPreview",
      async (node: LeafLike | undefined) => {
        const uri = node?.finding?.uri;
        const range = node?.finding?.diagnostic?.range;
        if (!uri) return;
        await vscode.commands.executeCommand("vscode.open", uri, {
          selection: range,
          preserveFocus: false,
          preview: false,
        });
      },
    ),
    // Filter the Findings tree by a substring. Matches against rule
    // ID, message body, and fsPath case-insensitively. Re-invoking
    // the command pre-fills the current filter so users can edit or
    // clear it (empty string clears).
    vscode.commands.registerCommand(
      "pipelineCheck.findings.filter",
      async () => {
        const current = findingsProvider.getFilter();
        const next = await vscode.window.showInputBox({
          title: "Filter Pipeline-Check findings",
          prompt:
            "Match rule ID, message text, or file path. Empty to clear.",
          value: current,
          placeHolder: "e.g. GHA-001 or release.yml",
        });
        if (next === undefined) return; // user cancelled
        findingsProvider.setFilter(next);
      },
    ),
    // Copy-install-command also lives in the welcome-state and is
    // promoted to a top-level command so users can re-find it after
    // dismissing the first-run notification.
    vscode.commands.registerCommand(
      "pipelineCheck.copyInstallCommand",
      async () => {
        await vscode.env.clipboard.writeText(
          'pip install "pipeline-check[lsp]"',
        );
        vscode.window.setStatusBarMessage(
          'Copied: pip install "pipeline-check[lsp]"',
          CONFIRM_TTL_MS,
        );
      },
    ),
    vscode.commands.registerCommand("pipelineCheck.goToNextFinding", () =>
      goToFinding("next"),
    ),
    vscode.commands.registerCommand("pipelineCheck.goToPreviousFinding", () =>
      goToFinding("previous"),
    ),
    vscode.commands.registerCommand("pipelineCheck.restart", async () => {
      await stopClient();
      await startClient();
      // Only confirm success when startClient left a live client behind.
      // If start failed it surfaced its own error toast; we'd otherwise
      // show "failed to start" and "restarted" at the same time.
      if (client) {
        vscode.window.showInformationMessage("Language server restarted.");
      }
    }),
    vscode.commands.registerCommand("pipelineCheck.showLog", () => {
      if (client?.outputChannel) {
        client.outputChannel.show();
      } else {
        vscode.window.showInformationMessage(
          "The language server is not running yet. Open a supported file " +
            "or run 'Pipeline-Check: Restart language server'.",
        );
      }
    }),
  );

  await startClient();

  // Fire-and-forget the one-time "what's new" toast for users who
  // just upgraded. Detached so a not-yet-dismissed notification never
  // blocks activation (same lesson as the LSP-failure toast). The
  // function persists the seen-version before showing, so a missed
  // notification doesn't repeat next launch.
  void showWhatsNewIfUpgraded(context, context.extension.packageJSON.version);
}

export async function deactivate(): Promise<void> {
  await stopClient();
}
