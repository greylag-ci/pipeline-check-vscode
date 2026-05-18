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
// under `pipeline_check/lsp/`; install via `pip install pipeline-check`.

import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("pipelineCheck");
  const command = config.get<string>("serverCommand", "python");
  const args = config.get<string[]>("serverArgs", ["-m", "pipeline_check.lsp"]);

  const serverOptions: ServerOptions = {
    run: { command, args, transport: TransportKind.stdio },
    debug: { command, args, transport: TransportKind.stdio },
  };

  // The document selector matches every file kind a pipeline_check rule
  // reads. The server further filters by file content + path so an
  // unrelated YAML file in the workspace (mkdocs.yml, a Helm
  // `values.yaml`, etc.) does not get false-positive analysis.
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "yaml" },
      { scheme: "file", language: "json" },
      { scheme: "file", language: "dockerfile" },
      { scheme: "file", language: "terraform" },
      { scheme: "file", language: "groovy" },
    ],
    synchronize: {
      configurationSection: "pipelineCheck",
    },
    outputChannelName: "Pipeline-Check",
  };

  client = new LanguageClient(
    "pipelineCheck",
    "Pipeline-Check",
    serverOptions,
    clientOptions,
  );

  // Registering the client itself on context.subscriptions hands its
  // dispose() to VS Code at deactivation; no need to track the
  // start()-returned Disposable separately like in the pre-v9 API.
  context.subscriptions.push(client);
  await client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
