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
import { FindingsTreeProvider, GroupMode } from "./findingsView";
import { filterByThreshold } from "./severityFilter";
import { registerStatusBar } from "./statusBar";

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
  // language ID for `.github/workflows/*.yml`).
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", pattern: "**/.github/workflows/*.{yml,yaml}" },
      { scheme: "file", pattern: "**/.gitlab-ci.yml" },
      { scheme: "file", pattern: "**/azure-pipelines.yml" },
      { scheme: "file", pattern: "**/bitbucket-pipelines.yml" },
      { scheme: "file", pattern: "**/.circleci/config.yml" },
      { scheme: "file", pattern: "**/cloudbuild.yaml" },
      { scheme: "file", pattern: "**/.buildkite/pipeline.yml" },
      { scheme: "file", pattern: "**/.drone.{yml,yaml}" },
      { scheme: "file", pattern: "**/Jenkinsfile" },
      { scheme: "file", pattern: "**/Dockerfile" },
      { scheme: "file", pattern: "**/Containerfile" },
    ],
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
        const threshold = vscode.workspace
          .getConfiguration("pipelineCheck")
          .get<string>("severityThreshold", "low");
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
  try {
    await client.start();
  } catch (err) {
    // The most common cause is `python -m pipeline_check.lsp` failing:
    // either Python is not on PATH or the [lsp] extra is not installed.
    // Surface the install command and the server log as two distinct
    // actions so the user can act on either without re-reading the
    // notification body. The notification chrome already shows the
    // extension name, so the message body doesn't repeat it.
    const message = err instanceof Error ? err.message : String(err);
    const choice = await vscode.window.showErrorMessage(
      `Language server failed to start (${message}).`,
      "Copy install command",
      "Open server log",
    );
    if (choice === "Copy install command") {
      await vscode.env.clipboard.writeText('pip install "pipeline-check[lsp]"');
      vscode.window.showInformationMessage(
        'Copied: pip install "pipeline-check[lsp]"',
      );
    } else if (choice === "Open server log") {
      outputChannel.show();
    }
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
  context.subscriptions.push(
    findingsView,
    vscode.commands.registerCommand("pipelineCheck.findings.refresh", () =>
      findingsProvider.refresh(),
    ),
    vscode.commands.registerCommand(
      "pipelineCheck.findings.changeGrouping",
      () => changeGrouping(findingsProvider),
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
}

export async function deactivate(): Promise<void> {
  await stopClient();
}
