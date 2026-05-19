# Pipeline-Check VS Code extension

[![CI](https://github.com/greylag-ci/pipeline-check-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/greylag-ci/pipeline-check-vscode/actions/workflows/ci.yml)
[![CodeQL](https://github.com/greylag-ci/pipeline-check-vscode/actions/workflows/codeql.yml/badge.svg)](https://github.com/greylag-ci/pipeline-check-vscode/actions/workflows/codeql.yml)
[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/greylag-ci.pipeline-check.svg)](https://marketplace.visualstudio.com/items?itemName=greylag-ci.pipeline-check)
[![Open VSX](https://img.shields.io/open-vsx/v/greylag-ci/pipeline-check?label=open%20vsx)](https://open-vsx.org/extension/greylag-ci/pipeline-check)
[![Installs](https://vsmarketplacebadges.dev/installs-short/greylag-ci.pipeline-check.svg)](https://marketplace.visualstudio.com/items?itemName=greylag-ci.pipeline-check)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CodeRabbit](https://img.shields.io/coderabbit/prs/github/greylag-ci/pipeline-check-vscode?labelColor=171717&color=FF570A&label=CodeRabbit+Reviews)](https://coderabbit.ai)

Lint CI/CD pipelines for 22 providers against OWASP Top 10 CI/CD Risks and 14 other compliance frameworks. 810+ rules, inline in your editor: severity-graded gutter squiggles, hover descriptions with `--explain` prose, and recommended-action hints. Built on the same rule registry as the [pipeline-check](https://github.com/dmartinochoa/pipeline-check) CLI, so editor findings match `pipeline_check --output json` byte-for-byte (modulo position translation).

<!--
Once docs/screenshots/01-inline.png, 02-findings-panel.png,
03-hover.png, and 04-status-bar.png exist, uncomment the block below.
See docs/screenshots/README.md for the capture recipe. The marketplace
listing renders these via GitHub's raw blob URL, so they don't need
to ship inside the .vsix.

![Inline findings in the editor gutter](docs/screenshots/01-inline.png)

![Findings panel in the activity bar, grouped by severity](docs/screenshots/02-findings-panel.png)

![Hover tooltip showing problem, description, and rule docs link](docs/screenshots/03-hover.png)

![Status bar item showing the per-severity tally](docs/screenshots/04-status-bar.png)
-->

## Features

- **Inline diagnostics** — gutter squiggles + the Problems panel get a row per finding, severity-graded so CRITICAL and HIGH read red, MEDIUM yellow, LOW info-blue. Hover shows the rule title, the `--explain` prose, and a link to the rule documentation.
- **Findings panel** — dedicated slot in the activity bar with a Pipeline-Check pipeline glyph. Re-groups findings by **severity** (default), **file**, or **rule** via the title-bar **Change Grouping** button; activity-bar icon carries a live count badge.
- **Status bar item** — bottom-left of the window, shows the top two severity counts at a glance (e.g. `🛡 3C 1H`). Click reveals the Findings panel.
- **CodeLens summary** — every scanned file carries a `Pipeline-Check: 2 critical · 1 high` lens at line 1. Click navigates to the Findings panel.
- **Keyboard navigation** — `Alt+F8` / `Shift+Alt+F8` jump between findings, with wrap at both ends. Mirrors VS Code's `F8` for "next problem" so muscle memory carries over.
- **Tunable signal** — `pipelineCheck.severityThreshold` quiets the editor surface (`low` / `medium` / `high` / `critical`) without restarting the server; `pipelineCheck.disabledProviders` silences whole providers in a monorepo where Pipeline-Check would otherwise lint files belonging to a sub-project.

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
| `pipelineCheck.serverCommand` | `python` | Command used to launch the language server. Override if `pipeline_check` is installed under a different interpreter. Marked `machine-overridable`: workspace overrides require an explicit prompt. |
| `pipelineCheck.serverArgs` | `["-m", "pipeline_check.lsp"]` | Arguments passed to the server command. Marked `machine-overridable` for the same reason. |
| `pipelineCheck.severityThreshold` | `low` | Lowest severity that produces a diagnostic. One of `low`, `medium`, `high`, `critical`. Mirrors the CLI's `--severity-threshold`. |
| `pipelineCheck.disabledProviders` | `[]` | Provider IDs to silence entirely. Diagnostics for files matching a disabled provider's path glob are dropped before they reach the editor. One of `github-actions`, `gitlab`, `azure`, `bitbucket`, `circleci`, `cloud-build`, `buildkite`, `drone`, `jenkins`, `dockerfile` (covers Containerfile too). |
| `pipelineCheck.trace.server` | `off` | Traces LSP traffic. Set to `verbose` when debugging. |

## Commands and keybindings

All commands appear in the Command Palette under the **Pipeline-Check** category.

| Command | Default keybinding |
|---|---|
| **Restart language server** — kills and respawns the LSP process |  |
| **Show language server output** — focuses the output channel (LSP server logs + `[client]` client-side breadcrumbs) |  |
| **Go to Next Finding** | <kbd>Alt</kbd>+<kbd>F8</kbd> |
| **Go to Previous Finding** | <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F8</kbd> |
| **Change Grouping** (Findings view) — Quick Pick: Severity / File / Rule |  |
| **Refresh** (Findings view) — re-render from the current diagnostic stream |  |

## Workspace trust

Pipeline-Check spawns the configured Python interpreter to analyze workflow files. To keep that subprocess from running on first-open of a freshly-cloned repository, the extension declares `capabilities.untrustedWorkspaces: "limited"` — it stays inactive until the workspace is trusted. The `serverCommand` / `serverArgs` settings are `machine-overridable`, so a malicious `.vscode/settings.json` can't silently swap the interpreter or inject arbitrary args even after trust is granted.

## Development

```bash
npm install
npm run compile           # typecheck + esbuild dev bundle
npm run watch             # bundle on change
npm test                  # vitest unit suite
npm run test:integration  # @vscode/test-electron — boots a real extension host
npm run smoke             # loads dist/extension.js with a vscode stub
npm run lint
```

Press <kbd>F5</kbd> in VS Code with this folder open to launch an extension-host instance with the extension loaded. Two debug profiles ship in [.vscode/launch.json](.vscode/launch.json):

- **Run Extension**: opens a fresh window with no workspace. Use this when iterating on the client wiring against a checkout of your own code.
- **Run Extension (sample workflow)**: opens `test-fixtures/sample-workflow/` as the workspace. The fixture is a deliberately-vulnerable GitHub Actions workflow and should produce four diagnostics (GHA-001, GHA-004, GHA-015, GHA-016) the moment you open the file. Quickest way to confirm the client → server round-trip works end-to-end.

## Packaging

```bash
npm run package           # delegates to `vsce package`, produces pipeline-check-<version>.vsix
```

## Releasing

Publishing is fully automated by [.github/workflows/publish.yml](.github/workflows/publish.yml). Tag a commit with `vX.Y.Z` matching `package.json#version`, push the tag, and the workflow packages the `.vsix`, publishes to both the VS Code Marketplace and Open VSX, and attaches the artifact to a GitHub Release with the matching `CHANGELOG.md` section as release notes.

```bash
git tag v0.1.2
git push origin v0.1.2
```

**Tag-naming convention:**

- `vX.Y.Z` → stable marketplace channel.
- `vX.Y.Z-rc.N` (or any version with a `-` after the semver core) → pre-release channel; the GitHub release is also marked `prerelease`.

Two repo secrets gate the publish jobs, both stored as **environment secrets** on the `production` GitHub Environment (required reviewer must approve before the publish steps run):

| Secret | Where it comes from |
|---|---|
| `VSCE_PAT` | Azure DevOps PAT scoped to *Marketplace → Manage*, bound to the `greylag-ci` publisher. |
| `OVSX_PAT` | Open VSX access token from the user-settings page, bound to the `greylag-ci` namespace. |

Every PR and every push to `main` is gated by [.github/workflows/ci.yml](.github/workflows/ci.yml) running across `[ubuntu-latest, windows-latest, macos-latest]` with: lint, typecheck, unit tests (vitest), bundle smoke (loads `dist/extension.js` against a `vscode` stub to verify the package is loadable), `npm audit --omit=dev --audit-level=high`, `vsce package`, and on Linux the `@vscode/test-electron` integration suite. Release-day surprises stay rare.

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

## Security

Report vulnerabilities privately via GitHub's [Private vulnerability reporting](https://github.com/greylag-ci/pipeline-check-vscode/security/advisories/new) — see [SECURITY.md](SECURITY.md) for the response SLA and threat model.

## License

[MIT](LICENSE).
