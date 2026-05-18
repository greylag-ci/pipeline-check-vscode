# Pipeline-Check VS Code extension

VS Code extension for [pipeline-check](https://github.com/dmartinochoa/pipeline-check), a CI/CD security posture scanner. Surfaces 800+ rule findings inline in the editor: severity badges, hover descriptions with `--explain` prose, and recommended-action hints.

## Install

Once the marketplace listings are live, install via the in-editor extension panel (search for `Pipeline-Check`) or directly:

```bash
# Microsoft VS Code Marketplace
code --install-extension greylag-ci.pipeline-check

# Open VSX (VSCodium, Gitpod, code-server, Cursor)
codium --install-extension greylag-ci.pipeline-check
```

You also need the Python server:

```bash
pip install "pipeline-check[lsp]"
```

## Status

**v0.1.0** — first release, pilot provider coverage (single-file workflow providers + Dockerfile). See [CHANGELOG.md](CHANGELOG.md) for the per-version trail.

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

Press <kbd>F5</kbd> in VS Code with this folder open to launch an extension-host instance with the extension loaded. Two debug profiles ship in `.vscode/launch.json`:

- **Run Extension** — opens a fresh window with no workspace. Use this when iterating on the client wiring against a checkout of your own code.
- **Run Extension (sample workflow)** — opens `test-fixtures/sample-workflow/` as the workspace. The fixture is a deliberately-vulnerable GitHub Actions workflow and should produce four diagnostics (GHA-001, GHA-004, GHA-015, GHA-016) the moment you open the file. Quickest way to confirm the client → server round-trip works end-to-end.

Two commands are registered in the running extension:

- **Pipeline-Check: Restart server** — kills and respawns the LSP process. Useful after editing the Python server in a sibling checkout.
- **Pipeline-Check: Show server log** — focuses the `Pipeline-Check` output channel where the server's `window/logMessage` traffic lands.

## Packaging

```bash
npm install -g @vscode/vsce
vsce package        # produces pipeline-check-<version>.vsix
```

## License

[MIT](LICENSE).
