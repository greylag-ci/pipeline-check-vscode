# Changelog

All notable changes to the Pipeline-Check VS Code extension. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

## [Unreleased]

PRs landing on `main` between releases append entries here. The release
commit collapses this section into `## [X.Y.Z] — <date>`.

### Changed

- **Marketplace polish pass.** The `package.json` `description` is
  rewritten so the numbers that differentiate this extension (22
  providers, 14 compliance frameworks beyond OWASP Top 10 CI/CD,
  810+ rules) land in the first 100 characters and survive the
  ~145-character truncation the marketplace search results impose.
  Command titles renamed to **Restart language server** and
  **Show language server output** so the palette entries are
  self-disambiguating without leaning on the `Pipeline-Check`
  category prefix. Every configuration setting switched from
  `description` to `markdownDescription` so backtick'd literals
  (`python`, `python -m pipeline_check.lsp`) render as code in the
  Settings UI rather than plain quoted text.

- **README restructured for the marketplace listing.** The first
  paragraph carries the same numbers as the marketplace description,
  followed by a **What it scans** provider table (the differentiating
  content that prospective users land on the listing to see).
  Dropped the `## Status` section (the marketplace already shows the
  version in the listing's metadata bar). Collapsed the
  architecture diagram behind a `<details>` block near the bottom of
  the page; it's a useful engineering reference but not the first
  scroll of a marketplace listing.

- **Start-failure notification carries two actions, not one.** When
  `python -m pipeline_check.lsp` fails to launch (Python missing
  from `PATH`, `[lsp]` extra not installed, server crash on import),
  the notification now exposes **Copy install command** alongside
  **Open server log**. The user can act on either without re-reading
  the message body. Notification copy stripped of the redundant
  `Pipeline-Check:` prefix that the notification chrome already
  shows.

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
