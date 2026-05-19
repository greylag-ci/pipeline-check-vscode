# Changelog

All notable changes to the Pipeline-Check VS Code extension. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

## [Unreleased]

PRs landing on `main` between releases append entries here. The release
commit collapses this section into `## [X.Y.Z] — <date>`.

### Added

- **Findings panel.** A dedicated activity-bar slot
  ("Pipeline-Check" — custom inverted-Y pipeline glyph at
  `media/pipeline-check.svg`) carries a `Findings` tree that
  re-groups the diagnostics the LSP server has already published.
  Strictly a re-presentation: never triggers its own scan, so the
  thin-transport-adapter promise in `extension.ts` stays intact.
  The activity-bar icon carries a live count badge so "how many
  findings does this workspace have right now?" is answerable
  without expanding the panel. Three group modes — severity
  (default), file, rule — are switched via a `Change Grouping`
  Quick Pick that marks the active mode with `$(check)`. Each leaf
  renders as the rule title plus a `RULE · file:LINE` description
  that drops whichever component is already implied by the parent
  group; clicking opens the file at the diagnostic range.
  CRITICAL is rendered as `flame` and HIGH as `error` so the two
  distinguish in the severity-grouped tree without breaking parity
  with the editor gutter (which has no "more red than red" state);
  INFO uses `circle-outline` themed to `descriptionForeground` so
  it is visibly the quietest row instead of inheriting the default
  foreground. The welcome state leads with what the extension does
  rather than what is missing; the diagnostic recovery links sit
  on a secondary "Not seeing findings?" line.

- **`pipelineCheck.severityThreshold` setting.** A new enum knob
  (`low` / `medium` / `high` / `critical`, default `low`) that mirrors
  the CLI's `--severity-threshold`. Drives a client-side
  `handleDiagnostics` middleware that filters out diagnostics whose
  upstream pipeline-check severity falls below the threshold before
  they reach the gutter or Problems panel, so the editor surface can
  be tuned independently of the CLI's report. The filter reads
  `Diagnostic.data["severity"]` (set by the v1.0.6 server) so it can
  distinguish `CRITICAL` from `HIGH` (both map to LSP `Error`).
  Diagnostics without the `data.severity` metadata pass through
  unconditionally, so an older server (or a non-pipeline-check
  publish) is never hidden.

### Security

- **`pipelineCheck.serverCommand` and `pipelineCheck.serverArgs` are now
  `machine-overridable`.** Workspace overrides require an explicit
  prompt, so a malicious `.vscode/settings.json` can't silently swap
  the interpreter or inject `-c "<code>"` once the user trusts the
  workspace.
- **Declared `capabilities.untrustedWorkspaces: "limited"`** and
  `virtualWorkspaces: false`. The extension stays inactive in
  untrusted workspaces until the user trusts them, so the LSP child
  process never spawns from a freshly-cloned, untrusted repo.
- **Hardened the publish workflow.** Pinned `@vscode/vsce` and `ovsx`
  to specific versions (no more `@latest` with PATs in env), added a
  `git merge-base` check that refuses to publish a tag that isn't on
  `main`, added a CHANGELOG-fold check, and narrowed workflow-level
  permissions to `contents: read` with the publish job opting up to
  `contents: write`. The publish job is gated on the `production`
  GitHub Environment so `VSCE_PAT` / `OVSX_PAT` are only readable from
  a run that has cleared required reviewers.
- **Added [SECURITY.md](SECURITY.md)** with GitHub Private Vulnerability
  Reporting as the disclosure channel, response SLAs, and a published
  threat model.

### Tests

- **Vitest unit suite added.** 25 tests covering the severity threshold
  filter (extracted into [src/severityFilter.ts](src/severityFilter.ts))
  and the Findings tree's pure logic (collection from
  diagnostics, group-by-severity / file / rule, severity normalisation,
  no-refresh-storm contract). `npm test` runs the suite; both ci.yml
  and publish.yml gate on it. Test files live next to the code they
  cover and are stripped from the .vsix.

### Fixed

- **The published `.vsix` was missing its runtime dependency.** The
  previous build emitted `out/extension.js` via `tsc` but excluded
  `node_modules/` from the package, so `require("vscode-languageclient/node")`
  threw on activation in a clean install. Now bundled with esbuild into
  a single `dist/extension.js` (the only JS in the `.vsix`); a CI
  smoke step ([scripts/smoke.js](scripts/smoke.js)) stubs the `vscode`
  module, loads the bundle, and asserts `activate` / `deactivate` are
  exported so this regression class fails the build instead of the user.

### Changed

- **`npm audit --omit=dev --audit-level=high` now runs on every push to
  `main`** so advisories filed after a PR has merged still surface.
- **Activation tightened.** The extension used to activate on every YAML
  / JSON / Dockerfile / Terraform / Groovy file in any workspace, then
  rely on the server's content filter to drop unrelated documents.
  `activationEvents` is now a `workspaceContains:` list of the trigger
  files we actually scan (`.github/workflows/*`, `.gitlab-ci.yml`,
  `azure-pipelines.yml`, etc.). The LSP's `documentSelector` is
  switched from language IDs to matching file-path globs, so the
  server only sees candidate documents — no more spurious activations
  on `package.json`, `mkdocs.yml`, or a Helm `values.yaml`.
- **`@vscode/vsce` and `ovsx` are pinned devDependencies.** Workflows
  invoke them via the locally-installed binaries (`npx vsce`,
  `npx ovsx`) after `npm ci`. Versions live in `package-lock.json`
  and Dependabot's existing npm config keeps them current.
- **Marketplace metadata polish.** Added `Other` to `categories`,
  pointed `qna` at the repo Discussions page.

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
