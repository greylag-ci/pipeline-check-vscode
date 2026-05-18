# Changelog

All notable changes to the Pipeline-Check VS Code extension. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

## [Unreleased]

PRs landing on `main` between releases append entries here. The release
commit collapses this section into `## [X.Y.Z] — <date>`.

## [0.1.0] — 2026-05-18

First public release. Wires the editor surface to the upstream
[`pipeline_check.lsp`](https://github.com/dmartinochoa/pipeline-check)
server.

### Added

- TypeScript LSP client that spawns `python -m pipeline_check.lsp`
  over stdio (`vscode-languageclient` v9). Document selector covers
  YAML, JSON, Dockerfile, Terraform, and Groovy files; the server
  filters further by path and content so unrelated documents are not
  analyzed.
- Pilot provider coverage: GitHub Actions, GitLab CI, Azure Pipelines,
  Bitbucket Pipelines, CircleCI, Google Cloud Build, Buildkite, Drone,
  Jenkins, and Dockerfile. Multi-file / context-heavy providers
  (Kubernetes, Helm, Terraform plans, live AWS, CloudFormation, SCM
  posture) follow in a later release.
- Three configuration knobs: `pipelineCheck.serverCommand`,
  `pipelineCheck.serverArgs`, and `pipelineCheck.trace.server` for
  overriding the Python interpreter, module path, and LSP trace level.
- Two commands under the `Pipeline-Check` category:
  - **Restart server** — stops the running client and respawns.
  - **Show server log** — focuses the `Pipeline-Check` output channel
    where `window/logMessage` traffic lands.
- Graceful start-failure handling: when `python -m pipeline_check.lsp`
  fails (Python not on `PATH`, `[lsp]` extra not installed, server
  crash on import), the editor surfaces a notification with the
  install hint plus an `Open server log` button.
- Two F5 debug profiles in `.vscode/launch.json`:
  - **Run Extension** — fresh extension-host window, no workspace.
  - **Run Extension (sample workflow)** — opens
    `test-fixtures/sample-workflow/` with a deliberately-vulnerable
    GitHub Actions workflow that fires GHA-001, GHA-004, GHA-015,
    and GHA-016 on open.

### Requirements

- VS Code 1.85+.
- Python 3.11+ with `pipeline-check[lsp]` installed:
  ```bash
  pip install "pipeline-check[lsp]"
  ```
