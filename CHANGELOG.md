# Changelog

All notable changes to the Pipeline-Check VS Code extension. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

> ⚠ **Release note for publish.yml:** the release-notes extractor (an
> `awk` script in publish.yml) prints every line between the **first**
> and **second** `## [` headers. When cutting a release, fold the
> entries under `## [Unreleased]` into the new `## [X.Y.Z] — <date>`
> section **above** Unreleased, or remove the Unreleased block for the
> release commit. Otherwise the GitHub release ships boilerplate.

## [Unreleased]

### Added

- **`Pipeline-Check: Filter Findings` command.** Opens an InputBox;
  matches against rule ID, message body, and file path
  (case-insensitive substring). Re-invoking the command pre-fills
  the current filter so users can edit or clear (empty input
  clears). New `$(filter)` button on the Findings view title bar.
  The badge updates to reflect the filtered count; the
  `lastFindingUris` set still tracks the unfiltered universe so a
  publish for a currently-hidden finding still wakes the tree up.
- **`Pipeline-Check: Open Finding` context-menu entry** on Findings
  tree leaves. Opens the finding as a **permanent (non-preview)**
  tab — useful when triaging multiple findings side-by-side. The
  default click-to-reveal still uses preview-style so the common
  "click through to scan" flow doesn't create tab clutter.
- **Status bar background colour reflects severity.** A workspace with
  any CRITICAL finding tints the bar to `statusBarItem.errorBackground`
  (red in the default themes); a workspace with HIGH but no CRITICAL
  tints to `statusBarItem.warningBackground` (yellow). MEDIUM / LOW /
  INFO keep the default fg colour so a "1 medium" workspace doesn't
  shout. Same ThemeColor tokens ESLint and Error Lens use, so the
  visual language reads correctly to any existing VS Code user.
- **"What's new" notification on upgrade.** First activation after a
  version bump shows a one-time toast — "Pipeline-Check 0.X.Y is here
  …" — with a "See release notes" button that opens the matching
  GitHub release. Persists the seen-version *before* showing so a
  missed dismissal doesn't loop next launch. Suppressed when the
  stored version equals the manifest version (same launch).
- **`Pipeline-Check: Scan Workspace` command.** Walks every CI/config
  file in the workspace (matching the same patterns the LSP's
  `documentSelector` uses), opens each via
  `vscode.workspace.openTextDocument` so the LSP's `didOpen` pipeline
  picks them up, and lets the Findings panel re-render from the
  diagnostic stream as scans complete. Progress toast with
  cancellation; partial failures (read errors, unsupported encodings)
  are counted but don't abort the scan. Surfaced from a `$(play)`
  button on the Findings view title bar, the Command Palette, and a
  link in the Findings welcome state. (R10, R15)

### Changed

- **Quieter clipboard confirmations.** Copy Rule ID and Copy LSP
  Install Command now write a 2-second status-bar message instead of
  firing a modal information toast. The copy still succeeded
  silently 95% of the time anyway; this confirms the action without
  stealing focus.
- **"Refresh Findings" now triggers a real scan** instead of just
  re-painting the tree from already-published diagnostics. Matches
  the user's mental model: clicking a refresh icon should fetch new
  data, not re-render stale data. (R10)
- **`SCAN_PATTERNS` removed in favour of `TRIGGER_PATTERNS`** from
  `providers.ts`. The single source of truth for which files are
  CI-relevant now drives the documentSelector, the activationEvents,
  and the workspace scan — three surfaces that used to drift apart.

## [0.2.0] — 2026-05-19

Closes 24 of 29 items from the 2026-05-19 in-depth UX/code review.
Adds the activity-bar Findings tree's missing affordances (status bar,
CodeLens, navigation, context menus, per-provider toggles), the
release-tooling polish (`production` environment gate, pre-release
channel, three-OS CI, integration tests), and the discovery /
accessibility pass.

**Heads-up for users with non-standard workflow paths:** the
extension's `activationEvents` now match only the
`workspaceContains:` patterns shared with the LSP `documentSelector`
(plus `onStartupFinished` so the activity-bar slot is always
visible). If your repo keeps CI definitions outside the standard
locations (e.g. `pipelines/build.yml` instead of
`.github/workflows/*.yml`), the extension still activates on
`onStartupFinished`, but the LSP only scans files matching the
document selector. Use `pipelineCheck.serverArgs` to point the LSP
at a different path or symlink your custom config into a standard
location.

### Added

- **Inline CodeLens summary.** Each scanned file carries a
  `Pipeline-Check: 2 critical · 1 high` lens at line 1. Click reveals
  the Findings panel. Re-emits on every diagnostic publish so the
  text tracks the latest scan. (R26)
- **Status bar item.** Bottom-left of the window, shows the top two
  non-zero severities (e.g. `$(shield) 3C 1H`) with a tooltip that
  breaks down the full per-severity tally. Click reveals the
  Findings panel. (R9)
- **Keyboard navigation.** `Alt+F8` / `Shift+Alt+F8` jump between
  Pipeline-Check findings in editor order (fsPath ascending, then by
  line); wraps at both ends. Mirrors VS Code's `F8` muscle memory
  for the global "Next Problem" command. (R12)
- **Per-provider toggles.** New `pipelineCheck.disabledProviders`
  setting silences whole providers. `dockerfile` covers both
  `Dockerfile` and `Containerfile` (same syntax). Useful in a
  monorepo where Pipeline-Check would otherwise lint a sub-project's
  Dockerfile that has its own lint pipeline. (R25)
- **Rule documentation link in leaf tooltip.** When the server
  publishes a `Diagnostic.code.target` URL, the Findings tree's
  leaf tooltip appends a clickable
  `$(book) <rule-id> documentation` link below the message body. (R8)
- **Client-side structured logging.** The extension's output channel
  now interleaves `[client] HH:MM:SS.mmm` lines around activation
  and command invocations with the LSP's `window/logMessage`
  traffic. Easier to triage bug reports — start/ok/failed
  breadcrumbs land in the same surface users already focus via
  *Show language server output*. (R16)
- **Pre-release channel.** Tags like `v0.2.0-rc.1` ship to the
  marketplace pre-release channel; the matching GitHub release is
  marked `prerelease`. Detection is by the presence of a `-` after
  the semver core. (R24)
- **Right-click context menu on Findings tree leaves.** *Open Rule
  Documentation* opens the URL the server published via
  `Diagnostic.code.target` in the system browser; *Copy Rule ID*
  writes the rule's identifier to the clipboard. Same data the leaf
  tooltip already surfaces, now available without keeping the
  tooltip open.
- **`pipelineCheck.codeLens.enabled` setting.** Defaults to `true`.
  Hides the line-1 file-summary CodeLens for users who find it
  intrusive without disabling CodeLens globally. Toggle takes effect
  on the next render — no extension restart.
- **`pipelineCheck.copyInstallCommand` command.** Copies
  `pip install "pipeline-check[lsp]"` to the clipboard. Surfaced
  from the Findings welcome state and from the Command Palette so
  users can re-find it after dismissing the first-run error toast.

### Changed

- **Welcome state of the Findings panel teaches.** Now leads with
  what Pipeline-Check does + a *Copy install command* link for the
  Python `[lsp]` extra, then onboarding ("open a workflow…"), then
  the Alt+F8 / Shift+Alt+F8 keyboard hint, then a `---` separator
  and the recovery actions (Restart, Open Log) demoted below.
- **`onStartupFinished` activation event.** The extension now wakes
  up after VS Code's start-up barrier so the activity-bar slot is
  visible in every workspace — not just ones with a
  `workspaceContains:` match. The LSP child process still only
  spawns when the `documentSelector` matches an open document, so
  there's no idle-Python-process cost.
- **Status bar item hides in non-CI workspaces.** On activation we
  do a one-shot `findFiles` for any of the trigger patterns; the
  status bar item only shows once we've seen evidence the workspace
  is CI-relevant (either a match or an actual diagnostic publish).
  Stops `$(shield) clean` cluttering the bottom-left in frontend
  projects that happen to have Pipeline-Check installed alongside
  other linters.
- **Status bar accessibility label.** Screen readers now hear
  "Pipeline-Check: 3 critical, 1 high" instead of the codicon
  shortcode + letter-by-letter abbreviation.
- **Status bar tooltip teaches Alt+F8.** The trailing line of the
  tooltip ("Alt+F8 / Shift+Alt+F8 to step through findings") is the
  primary discovery surface for the navigation keybindings.
- **Command titles use title case** for VS Code's convention:
  "Restart Language Server", "Show Language Server Output",
  "Refresh Findings". Existing "Go to Next Finding" and "Change
  Grouping" stay the same. Command IDs are unchanged — settings,
  keybindings, and automation continue to work.

- **`@vscode/test-electron` integration suite** now runs in CI
  (Linux only, via `xvfb-run -a`). Five tests pin activation, the
  command-registration contract, the Findings view registration,
  the configuration schema completeness, and the workspace-trust
  capability declarations. Catches what unit tests can only
  approximate. (R17)
- **Three-OS test matrix** — `[ubuntu-latest, windows-latest,
  macos-latest]`. The LSP child-process spawn path is
  Windows-sensitive; matrix CI catches the LF/CRLF and
  path-separator bugs single-OS CI silently misses. (R21)
- **Activation surface narrowed.** Triggers are
  `workspaceContains:` patterns matching the providers we actually
  scan (the `documentSelector` uses the same patterns). Opening an
  unrelated `package.json` or `mkdocs.yml` no longer wakes up the
  extension. (H4)
- **Trigger-pattern list lives in one place.** Extracted into
  `src/providers.ts` as a single `PROVIDERS` map; the `documentSelector`,
  `activationEvents`, and the LSP middleware's per-provider filter
  all read from it. A regression test asserts the manifest's
  `activationEvents` stay in lockstep with the patterns. (R14)
- **Shared `vi.mock("vscode")` factory** under `src/__testStubs__/`.
  Unit tests now share a single stub instead of redefining the
  surface per file. (R18)
- **Marketplace description length** gated in CI at the
  145-character truncation point so future edits don't blow it. (R20)

### Fixed

- **`Restart language server` toast no longer fires on failure** —
  if the server failed to come up, the error notification already
  carries the install hint; the success toast used to fire too,
  giving the user contradictory signals. (R2)
- **`stopClient` has a 2-second hard ceiling** on the LSP child's
  shutdown. A deadlocked server used to hold the deactivate path
  indefinitely; VS Code reported "Window not responding" until the
  user force-quit. (R3)
- **`groupByFile` no longer round-trips Uri through string** for
  every group node. Bucket value carries the original Uri. (R4)
- **`compareByLocation` sorts on `fsPath`** instead of the full URI
  string. Cross-scheme entries (file:// vs untitled://) no longer
  bunch at one end. (R5)
- **`collectFindings` is memoised per refresh** — buildRoot and
  updateBadge used to walk the global diagnostic store twice per
  refresh. (R6)
- **`onDidChangeDiagnostics` skips refreshes from unrelated
  publishers.** ESLint / mypy / redhat.yaml keystroke chatter no
  longer rebuilds the tree. The skip-check also catches *clears*
  (a stale leaf can't outlive a cleared file). (R7)

## [0.1.1] — 2026-05-19

Production-readiness pass. v0.1.0 was effectively unusable on a clean
install (see **Fixed** below); v0.1.1 is the first release that
actually loads in VS Code. Also lands the Findings panel and the
security hardening from the pre-marketplace review.

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
