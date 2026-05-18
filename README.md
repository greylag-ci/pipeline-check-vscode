# Pipeline-Check VS Code extension

VS Code extension for [pipeline-check](https://github.com/dmartinochoa/pipeline-check), a CI/CD security posture scanner. Surfaces 800+ rule findings inline in the editor: severity badges, hover descriptions with `--explain` prose, and recommended-action hints.

## Status

**Pre-MVP scaffold.** The TypeScript LSP client is wired up; the `pipeline_check.lsp` server lives upstream in `dmartinochoa/pipeline-check` and is under construction. The extension installs cleanly today and will start producing lint output once the server half ships.

## Architecture

```text
┌──────────────────────┐     stdio JSON-RPC      ┌──────────────────────────┐
│ VS Code extension    │ ◀─────────────────────▶ │ pipeline_check.lsp        │
│ (TypeScript, this    │                          │ (Python, pygls; lives in  │
│  repo)               │                          │  dmartinochoa/pipeline-   │
│                      │                          │  check)                   │
└──────────────────────┘                          └──────────────────────────┘
```

The extension spawns `python -m pipeline_check.lsp` as a child process and exchanges Language Server Protocol messages over stdin / stdout. The server reads the same rule registry that powers the CLI, so editor findings match `pipeline_check --output json` byte-for-byte (modulo position translation).

## Requirements

- VS Code 1.85 or newer.
- Python 3.11 or newer on `PATH`, with `pipeline-check` installed: `pip install pipeline-check`.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `pipelineCheck.serverCommand` | `python` | Command used to launch the LSP server. Override if `pipeline_check` is installed under a different interpreter. |
| `pipelineCheck.serverArgs` | `["-m", "pipeline_check.lsp"]` | Arguments passed to the server command. |
| `pipelineCheck.trace.server` | `off` | Traces LSP traffic. Set to `verbose` when debugging. |

## Development

```bash
npm install
npm run compile     # one-shot compile
npm run watch       # rebuild on change
```

Press <kbd>F5</kbd> in VS Code with this folder open to launch an extension-host instance with the extension loaded. The `Run Extension` launch profile is committed in `.vscode/launch.json`.

## Packaging

```bash
npm install -g @vscode/vsce
vsce package        # produces pipeline-check-<version>.vsix
```

## License

[MIT](LICENSE).
