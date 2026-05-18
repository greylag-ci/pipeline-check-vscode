# Pipeline-Check VS Code extension

[![CI](https://github.com/greylag-ci/pipeline-check-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/greylag-ci/pipeline-check-vscode/actions/workflows/ci.yml)
[![CodeQL](https://github.com/greylag-ci/pipeline-check-vscode/actions/workflows/codeql.yml/badge.svg)](https://github.com/greylag-ci/pipeline-check-vscode/actions/workflows/codeql.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/greylag-ci.pipeline-check?logo=visualstudiocode&label=marketplace)](https://marketplace.visualstudio.com/items?itemName=greylag-ci.pipeline-check)
[![Open VSX](https://img.shields.io/open-vsx/v/greylag-ci/pipeline-check?label=open%20vsx)](https://open-vsx.org/extension/greylag-ci/pipeline-check)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/greylag-ci.pipeline-check?label=installs)](https://marketplace.visualstudio.com/items?itemName=greylag-ci.pipeline-check)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CodeRabbit](https://img.shields.io/coderabbit/prs/github/greylag-ci/pipeline-check-vscode?labelColor=171717&color=FF570A&label=CodeRabbit+Reviews)](https://coderabbit.ai)

Lint CI/CD pipelines for 22 providers against OWASP Top 10 CI/CD Risks and 14 other compliance frameworks. 810+ rules, inline in your editor: severity-graded gutter squiggles, hover descriptions with `--explain` prose, and recommended-action hints. Built on the same rule registry as the [pipeline-check](https://github.com/dmartinochoa/pipeline-check) CLI, so editor findings match `pipeline_check --output json` byte-for-byte (modulo position translation).

<!--
Once docs/screenshots/01-inline.png, 02-problems-panel.png, and
03-hover.png exist, uncomment the block below. See
docs/screenshots/README.md for the capture recipe. The marketplace
listing renders these via GitHub's raw blob URL, so they don't need
to ship inside the .vsix.

![Inline findings in the editor gutter](docs/screenshots/01-inline.png)

![The Problems panel with clickable rule IDs](docs/screenshots/02-problems-panel.png)

![Hover tooltip showing problem, description, and fix](docs/screenshots/03-hover.png)
-->

## What it scans

Pilot provider coverage (single-file workflow providers plus Dockerfile):

| Provider | Trigger file(s) |
|---|---|
| GitHub Actions | `.github/workflows/*.yml` |
| GitLab CI | `.gitlab-ci.yml` |
| Azure DevOps | `azure-pipelines.yml` |
| Bitbucket Pipelines | `bitbucket-pipelines.yml` |
| CircleCI | `.circleci/config.yml` |
| Google Cloud Build | `cloudbuild.yaml` |
| Buildkite | `.buildkite/pipeline.yml` |
| Drone CI | `.drone.yml` / `.drone.yaml` |
| Jenkins | `Jenkinsfile` (Declarative and Scripted) |
| Dockerfile | `Dockerfile` / `Containerfile` |

Multi-file and context-heavy providers (Kubernetes, Helm, Terraform plans, live AWS, CloudFormation, SCM posture) ship in a later release; the CLI already covers them.

## Install

Search for `Pipeline-Check` in the extensions panel, or install from the command line:

```bash
# Microsoft VS Code Marketplace
code --install-extension greylag-ci.pipeline-check

# Open VSX (VSCodium, Gitpod, code-server, Cursor)
codium --install-extension greylag-ci.pipeline-check
```

The extension is a thin LSP client; the rule engine itself runs in Python and must be installed separately:

```bash
pip install "pipeline-check[lsp]"
```

## Requirements

- VS Code 1.85 or newer.
- Python 3.11 or newer on `PATH`, with `pipeline-check[lsp]` installed.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `pipelineCheck.serverCommand` | `python` | Command used to launch the language server. Override if `pipeline_check` is installed under a different interpreter. |
| `pipelineCheck.serverArgs` | `["-m", "pipeline_check.lsp"]` | Arguments passed to the server command. |
| `pipelineCheck.severityThreshold` | `low` | Lowest severity that produces a diagnostic. One of `low`, `medium`, `high`, `critical`. Mirrors the CLI's `--severity-threshold`. |
| `pipelineCheck.trace.server` | `off` | Traces LSP traffic. Set to `verbose` when debugging. |

## Development

```bash
npm install
npm run compile     # one-shot compile
npm run watch       # rebuild on change
```

Press <kbd>F5</kbd> in VS Code with this folder open to launch an extension-host instance with the extension loaded. Two debug profiles ship in `.vscode/launch.json`:

- **Run Extension**: opens a fresh window with no workspace. Use this when iterating on the client wiring against a checkout of your own code.
- **Run Extension (sample workflow)**: opens `test-fixtures/sample-workflow/` as the workspace. The fixture is a deliberately-vulnerable GitHub Actions workflow and should produce four diagnostics (GHA-001, GHA-004, GHA-015, GHA-016) the moment you open the file. Quickest way to confirm the client → server round-trip works end-to-end.

Two commands are registered in the running extension:

- **Pipeline-Check: Restart language server**: kills and respawns the LSP process. Useful after editing the Python server in a sibling checkout.
- **Pipeline-Check: Show language server output**: focuses the `Pipeline-Check` output channel where the server's `window/logMessage` traffic lands.

## Packaging

```bash
npx @vscode/vsce package        # produces pipeline-check-<version>.vsix
```

## Releasing

Publishing is fully automated by [.github/workflows/publish.yml](.github/workflows/publish.yml). Tag a commit with `vX.Y.Z` matching `package.json#version`, push the tag, and the workflow packages the `.vsix`, publishes to both the VS Code Marketplace and Open VSX, and attaches the artifact to a GitHub Release with the matching `CHANGELOG.md` section as release notes.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Two repo secrets gate the publish jobs:

| Secret | Where it comes from |
|---|---|
| `VSCE_PAT` | Azure DevOps PAT scoped to *Marketplace → Manage*, bound to the `greylag-ci` publisher. |
| `OVSX_PAT` | Open VSX access token from the user-settings page, bound to the `greylag-ci` namespace. |

Every PR and every push to `main` is gated by [.github/workflows/ci.yml](.github/workflows/ci.yml) on the same three checks the release runs first (lint, type-compile, and a clean `vsce package`), so a contributor whose change cannot ship never makes it past review.

<details>
<summary>Architecture</summary>

```text
┌──────────────────────┐     stdio JSON-RPC      ┌──────────────────────────┐
│ VS Code extension    │ ◀─────────────────────▶ │ pipeline_check.lsp        │
│ (TypeScript, this    │                          │ (Python, pygls; lives in  │
│  repo)               │                          │  dmartinochoa/pipeline-   │
│                      │                          │  check)                   │
└──────────────────────┘                          └──────────────────────────┘
```

The extension spawns `python -m pipeline_check.lsp` as a child process and exchanges Language Server Protocol messages over stdin / stdout. The server reads the same rule registry that powers the CLI, so editor findings match `pipeline_check --output json` byte-for-byte (modulo position translation).

</details>

## License

[MIT](LICENSE).
