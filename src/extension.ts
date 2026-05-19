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

const LANGUAGE_ID = "pipelineCheck";
const LANGUAGE_NAME = "Pipeline-Check";
const OUTPUT_CHANNEL = "Pipeline-Check";

// Upstream severity ranks. Higher = more severe. The server stuffs the
// pipeline-check severity name into Diagnostic.data["severity"] (e.g.
// "CRITICAL"). The LSP DiagnosticSeverity enum collapses CRITICAL + HIGH
// into a single Error value, so we can't filter precisely on
// vscode.Diagnostic.severity alone.
const SEVERITY_RANK: Record<string, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

// Threshold knob values. Map each to the rank a diagnostic must
// reach to survive the filter.
const THRESHOLD_RANK: Record<string, number> = {
  low: SEVERITY_RANK.LOW,
  medium: SEVERITY_RANK.MEDIUM,
  high: SEVERITY_RANK.HIGH,
  critical: SEVERITY_RANK.CRITICAL,
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

  // The selector matches every file kind a pipeline_check rule reads.
  // The server further filters by file content + path so an unrelated
  // YAML file in the workspace (mkdocs.yml, a Helm `values.yaml`, etc.)
  // does not get false-positive analysis.
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "yaml" },
      // The official GitHub Actions extension (github.vscode-github-actions)
      // assigns its own language ID to .github/workflows/*.yml. Without
      // this entry the headline use case (GHA linting) is invisible to the
      // extension for anyone who has the GitHub Actions extension installed.
      { scheme: "file", language: "github-actions-workflow" },
      { scheme: "file", language: "json" },
      { scheme: "file", language: "dockerfile" },
      { scheme: "file", language: "terraform" },
      { scheme: "file", language: "groovy" },
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
        // VS Code constrains the setting to the enum in package.json, so
        // the lookup should always hit. The `?? LOW` is defense-in-depth
        // against a hand-edited settings.json with a bogus value: a
        // diagnostic must clear the LOW bar, never silently disappear.
        const minRank = THRESHOLD_RANK[threshold] ?? SEVERITY_RANK.LOW;
        const filtered = diagnostics.filter((diag) => {
          const data = (diag as vscode.Diagnostic & {
            data?: { severity?: string };
          }).data;
          const name = data?.severity;
          if (!name) {
            return true;
          }
          const rank = SEVERITY_RANK[name];
          return rank === undefined || rank >= minRank;
        });
        next(uri, filtered);
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

async function stopClient(): Promise<void> {
  if (!client) {
    return;
  }
  const local = client;
  client = undefined;
  await local.stop();
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand("pipelineCheck.restart", async () => {
      await stopClient();
      await startClient();
      vscode.window.showInformationMessage("Language server restarted.");
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
