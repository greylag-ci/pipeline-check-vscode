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

## [1.1.0] — 2026-05-25

Feature batch on top of v1.0.3. Three user-visible additions plus
infrastructure for a fourth: a Findings-panel severity quick-filter
(mute MEDIUM while triaging CRITICAL without touching the editor-wide
threshold setting), a quick-fix lightbulb on every diagnostic (Open
docs / Copy rule ID / Reveal in panel), and a fast-fail engine
preflight that surfaces the install or upgrade action in under a
second instead of waiting out the 30-second LSP start ceiling. The
status-bar tooltip now carries the engine version so users can
confirm at a glance which `pipeline-check` install is talking to the
editor. Test count: 254 → 329 (75 new) across the new and extended
suites — severity filter, code actions, preflight, version compare,
upgrade flow, status-bar tooltip, lspState.

### Added

- **Per-panel severity quick-filter.** New title-bar **Show / Hide
  Severities** button opens a multi-select Quick Pick; unchecked
  severities are hidden from the Findings panel only. The editor
  surface (gutter, Problems panel, CodeLens) is unaffected — the
  filter is for triage, not for muting the project. State persists
  per workspace via `workspaceState`. Composes with the existing
  substring filter; both are dropped when their condition clears.
- **Quick-fix lightbulb on every Pipeline-Check diagnostic.**
  Rule-agnostic actions land on every finding the lightbulb attaches
  to: **Open `<RULE-ID>` documentation** (when the server published
  `Diagnostic.code.target`), **Copy rule ID** (routes through the
  same code path as the panel's context-menu entry), and **Show in
  Pipeline-Check Findings panel** (always available). No CodeAction
  mutates the file — they're discoverability surfaces, not
  auto-fixes.
- **Fast-fail engine preflight.** Before `LanguageClient.start()`
  spawns the LSP, a 5-second probe runs
  `import pipeline_check; print(importlib.metadata.version(...))`
  on the configured interpreter. A missing install fires the install
  toast in under a second instead of the 30-second LSP start
  ceiling. An out-of-date install (engine version below
  `MIN_ENGINE_VERSION`) routes to a dedicated **Upgrade in terminal**
  CTA instead of the generic install path. The probe is gated to
  the default `python -m pipeline_check.lsp` shape so custom wrapper
  scripts skip the check (`shouldPreflight` returns `false`) and
  fall back to the existing start-timeout behavior.
- **Engine version in the status-bar tooltip.** The captured version
  appears as a trailing `Engine vX.Y.Z` line on hover. Useful for
  triaging "why isn't this rule firing?" reports across people on
  different upstream versions. Cleared on `stopClient()` and on the
  mid-session `State.Stopped` transition so the tooltip stops
  claiming a server is connected after a crash.
- **`pipelineCheck.upgradeInTerminal` command + welcome panel
  variant.** New command runs
  `python -m pip install --upgrade "pipeline-check[lsp]"` in a
  dedicated `Pipeline-Check upgrade` terminal (typed but not
  auto-executed, matching the install-command pattern). When the
  preflight rejects with `reason="out_of_date"`, the new
  `pipelineCheck.engineOutOfDate` context key flips, and the
  Findings panel switches to a third welcome entry that promotes
  **Upgrade in terminal** as its primary CTA. The toast and the
  panel surface the same action so a user who dismisses the toast
  can still find it.

### Changed

- **README: Install section rewritten** as a numbered two-step flow
  ("install the Python engine, then install the extension") so
  first-timers can't skip the engine. Version requirements moved
  inline with each step; the standalone Requirements section is
  gone. A new "Verify" step points readers at the `🛡` status-bar
  tally and the `Pipeline-Check: Show language server output`
  command for the case where it doesn't appear. The Commands table
  was also extended to list the two new commands and the
  severity-toggle entry.
- **`What's new` toast copy is now generic.** Previously it
  hard-coded the v1.0.0 surfaces (Findings panel, status bar,
  CodeLens, Alt+F8); the prose was stale the moment 1.0.1 shipped.
  The toast now says `Pipeline-Check ${version} is here. See what
  changed?` and the **See release notes** action does the
  version-specific work. One less thing to remember to update per
  release.

### Infrastructure

- **`MIN_ENGINE_VERSION = "1.0.0"`** in
  [src/preflight.ts](src/preflight.ts) is the new floor the preflight
  asserts. Anyone on a 0.x install sees the **Upgrade in terminal**
  CTA on next launch; every 1.0.x install passes through unchanged.
  The extension's stable contract with the engine — reading
  `Diagnostic.code.target` (rule-docs URL) and `data.severity` (panel
  grouping) from publishes — has held across the 1.x line, so the
  floor is the same as the 1.x major. **Maintainer note:** bump
  patch/minor here when the extension starts depending on a newer
  field; the change forces the upgrade prompt for users behind the
  new floor and deserves its own CHANGELOG entry.
- **`isAtLeast` / `parseVersion`** helpers in preflight handle the
  PEP 440 / SemVer shapes pipeline-check ships (numeric
  MAJOR.MINOR.PATCH plus occasional rc / dev tails). Pre-releases
  rank BELOW the corresponding release per spec, so `1.2.3rc1` does
  not satisfy a `MIN_ENGINE_VERSION = "1.2.3"` assertion.

## [1.0.3] — 2026-05-21

Recovery republish of v1.0.2 — Open VSX returned an HTTP 405 on
the v1.0.2 publish step (transient registry-side failure; v1.0.1
shipped unchanged 14 h earlier through the same code path).
v1.0.2 reached the VS Code Marketplace but not Open VSX, and the
"Create GitHub release" step short-circuited behind the failed
publish. No source changes between v1.0.2 and v1.0.3; this tag
exists solely to re-trigger the publish pipeline so Open VSX
catches up with the Marketplace and the GitHub release for the
1.0.x line is restored.

### Changed

- **Version bump only — no functional changes.** v1.0.2 is the
  identical extension code; users on the VS Code Marketplace will
  see a 1.0.2 → 1.0.3 update with no behavioural diff. Open VSX
  users skip 1.0.2 entirely (none was ever published there).

## [1.0.2] — 2026-05-20

Bug-fix batch on top of v1.0.1 — three review rounds turned up five
real defects and a handful of housekeeping items, all covered by
nine new unit tests (245 → 254). No new features; no behaviour
change for users on the golden path. Highlights: rapid-fire LSP
restarts no longer race into a `TypeError` in the extension host;
`Pipeline-Check: Scan Workspace` failures land a real
extension-branded error instead of VS Code's generic "Command
failed" toast; `scan-on-save` rejections now surface in the output
channel instead of leaking as unhandled promise rejections; the
`What's New` upgrade-toast comparison handles double-digit
pre-release identifiers (`rc.10 > rc.2`); and the internal `**`
glob no longer matches mid-segment (a file literally named
`myDockerfile` is no longer classified as a Dockerfile).

### Fixed

- **Restart-during-startup race in the LSP client no longer crashes
  the extension host.** `startClient` referenced the module-level
  `client` after awaiting `client.start()`; a concurrent
  `stopClient` (second `Pipeline-Check: Restart` click, or
  `deactivate` mid-startup) could clear the slot before
  `onDidChangeState` wired up, throwing `TypeError: Cannot read
  properties of undefined`. The client is now captured into a
  local before the await, with an identity check after — if the
  slot was swapped, the orphaned LSP child is killed cleanly and
  no shared state is touched.
- **`Pipeline-Check: Scan Workspace` / `Refresh Findings` rejections
  surface a real toast.** If `findFiles` rejects before the loop
  starts (workspace closed mid-call, fs error), `scanWorkspace`
  re-throws; the command surface used to render that as a generic
  `Command 'pipelineCheck.scanWorkspace' resulted in an error`
  toast divorced from the click. A new `runScanCommand` wrapper
  catches the rejection, writes a `scan: failed to start` line to
  the Pipeline-Check output channel, and shows a
  Pipeline-Check-branded `showErrorMessage` instead. Per-file
  failures still flow through the normal `formatSummary` path.
- **`scan-on-save` rejections no longer leak as unhandled promise
  rejections.** `onDidSaveTextDocument` is fire-and-forget, so a
  rejected scan promise used to land as an "unhandled promise
  rejection" in the extension-host log with no connection back to
  the save that triggered it. The handler now catches scan
  failures, routes them through a new optional `onError` hook
  wired to the Pipeline-Check output channel, and resolves
  cleanly. The busy-lock still releases on every exit path.
- **`What's New` upgrade compare now follows semver §11.4 for
  pre-release identifiers.** The previous implementation compared
  pre-release suffixes lexicographically, so `rc.10` ranked
  *below* `rc.2` (because `'1' < '2'` in ASCII order) — a user on
  `rc.2` upgrading to `rc.10` would not see the upgrade toast.
  Numeric identifiers now compare numerically, non-numeric
  lexically, numeric ranks below non-numeric, and a longer
  identifier set wins on tie.
- **Internal `**/` glob matcher no longer crosses segment
  boundaries.** `**` translated to `.*`, so `**/Dockerfile`
  matched `myDockerfile` (no slash before the `D`). The
  `disabledProviders` middleware filter would then silence the
  wrong file. `**/` now translates to `(?:.*/)?` so the prefix
  must end on a real `/` (or be empty).

### Changed

- **`vscode:prepublish` ships with a synced `package-lock.json`.**
  The lockfile's top-level `"version"` had drifted to `1.0.0`
  while `package.json` advanced through `1.0.1`; this release
  brings both to `1.0.2` so the `npm ci` reproducibility contract
  the publish workflow relies on stays clean.
- **`log.setLogChannel` accepts `undefined`.** The module already
  treated a missing channel as a no-op; the signature now
  documents that explicitly so tests (and any future caller that
  needs to detach) don't have to lie via
  `undefined as unknown as OutputChannel`.

### Internal

- **Manifest welcome-link regex now captures dotted command IDs.**
  The regression-fence test that verifies every
  `command:pipelineCheck.X` link in the welcome panel maps to a
  declared command was stopping at the first `.`, so a future
  welcome edit that linked to `pipelineCheck.findings.refresh`
  would have slipped past the check.
- **`workspaceScan` and `navigate` test names match what they
  actually test, with new sibling tests for the propagation
  paths.** The old "withProgress throws" test only exercised the
  per-file caught-failure case; a new test now reaches the real
  pre-loop `findScannableFiles` rejection path. The
  "strict comparison" navigate test now uses two findings so it
  actually verifies advancement (the old single-element setup
  only proved wrap-around).
- **`codeLens` / `findingsView` test suites now use the full
  `resetStubState()` reset.** Closes a latent fragility where a
  future assertion on `__stubCalls.executeCommand` (populated by
  the `FindingsTreeProvider` constructor's `setContext` call)
  would have inherited stale state from earlier tests in the
  same file.
- **CodeQL workflow trimmed.** Drops the GitHub template
  scaffolding (`build-mode` matrix include, `swift`-vs-`ubuntu`
  runner-os switch, manual-build placeholder step) so the file
  shows only what we actually configure — the same three
  languages (`actions`, `javascript-typescript`, `python`) and
  the same pinned action SHAs.

## [1.0.1] — 2026-05-19

Stability batch on top of v1.0.0 — three rounds of edge-case
hardening covered by 57 new tests (194 → 251), plus supply-chain
hardening on the publish pipeline (CycloneDX SBOM + signed SLSA
provenance attached to each release). No new features; no behavior
change for users on the golden path. Highlights: the LSP install
command now uses the universal `python -m pip` form so the official
Windows Python installer + corporate ExecutionPolicy combo stops
blocking first-run install; the welcome panel and status bar no
longer go stale after an LSP crash or workspace-folder removal;
`Scan workspace` against a dead LSP surfaces a real error instead of
a false-success toast; the rc → ga "What's new" toast actually fires
this time.

### Security

- **CycloneDX SBOM attached to each GitHub release.** The publish
  workflow now scans `package-lock.json` via `anchore/sbom-action`
  and uploads `pipeline-check-<version>-sbom.cdx.json` alongside the
  `.vsix`. Downstream consumers can ingest it into their existing
  vuln-management tooling without re-deriving the dep set from the
  bundle.
- **Signed SLSA build provenance for each `.vsix`.** Emitted by
  `actions/attest-build-provenance` using GitHub's OIDC token and
  Sigstore's keyless flow. Consumers verify with
  `gh attestation verify pipeline-check-<version>.vsix --owner greylag-ci`.
  Covers signing (no separate cosign step) and provenance in one
  attestation.
- **`npm audit --omit=dev --audit-level=high` gate on the publish
  workflow.** CI already runs this on every push; the publish-side
  gate catches advisories that land between the merge to `main` and
  the tag push, preventing a known-vulnerable build from shipping
  during the window between merge and release.

### Changed

- **Install command now uses `python -m pip install`.** Switched from
  the bare `pip install` form so the install path works under two
  conditions that previously broke it: a corporate Windows
  PowerShell ExecutionPolicy that allows `python.exe` but blocks
  `pip.exe`, and the case where `python` is on `PATH` but `pip` is
  not (common with the official Windows Python installer when the
  Scripts directory wasn't added). Matches PyPA's own
  recommendation. README and welcome-panel copy updated.

### Fixed (round 3: low-severity batch)

- **Status-bar relevance latch releases on folder removal.** A
  multi-root workspace user who removed the last CI folder used to
  see the bar item pinned to "clean" for the rest of the session.
  The latch now re-evaluates on `onDidChangeWorkspaceFolders`: when
  the workspace has no CI candidate files AND no current findings,
  the item hides again. Re-adding a CI folder re-shows.

### Fixed (round 2: medium-severity batch)

- **Two scan-workspace runs in parallel no longer spawn two
  notifications.** A module-level in-flight guard collapses every
  concurrent `scanWorkspace` caller to one scan. A second call (from
  a double-clicked button, or scan + refresh) returns immediately
  with `skippedAsBusy: true` and, in noisy mode, surfaces a
  "scan already in progress" info toast.
- **`installInTerminal` reuses the existing "Pipeline-Check install"
  terminal.** Repeated clicks on the welcome-panel CTA used to stack
  identical terminals in the dropdown. Now the second click reuses
  the live terminal; an exited terminal is treated as dead and a
  fresh one takes its place.
- **`scan-on-save` short-circuits when the saved file's provider is
  disabled.** Saving a Dockerfile in a workspace that has
  `dockerfile` in `pipelineCheck.disabledProviders` used to trigger
  a full workspace re-open even though every published diagnostic
  would be dropped by the middleware. The handler now consults the
  live `disabledProviders` setting and skips the scan.
- **`whatsNew` rc → ga transition is no longer silently swallowed.**
  Per semver §11 a pre-release version is LOWER precedence than the
  corresponding release. The previous version-compare stripped the
  suffix and treated `1.0.0-rc.1` and `1.0.0` as equal, so
  pre-release testers never saw the "What's New" toast for the GA.

### Fixed

- **Welcome panel stops lying after an LSP crash.** Subscribe to
  `client.onDidChangeState` so a mid-session server crash (or the
  LanguageClient's auto-restart exhausting) flips `pipelineCheck.lspReady`
  back to `false`. Previously the panel kept showing "Scan workspace"
  after the LSP died — the button still worked, it just opened files
  against a dead server.
- **`disabledProviders` now silences lowercase `dockerfile` /
  `jenkinsfile`.** The internal glob matcher in `providerForPath` was
  case-sensitive against `**/Dockerfile`, so files written in lowercase
  (common on Windows case-preserving filesystems) classified as
  `undefined` and slipped past the user's disable filter.
- **Activation no longer hangs on a misconfigured `serverArgs`.**
  `client.start()` is now raced against a 30-second timeout. An empty
  `pipelineCheck.serverArgs` used to drop the Python child into the
  REPL where it waited on stdin forever; activation would stay
  half-pending and the welcome panel would never leave the install
  prompt. On timeout we kill the stranded subprocess and surface the
  same "Install in terminal / Open server log" toast the LSP-failure
  path uses.
- **`Scan workspace` no longer claims success against a dead LSP.**
  The scan command now gates on `isLspReady()` and surfaces a warning
  toast with **Install in terminal / Restart language server / Open
  server log** when the LSP is down. Quiet mode (scan-on-save) stays
  silent. Previously the scan would `openTextDocument` every candidate
  file, publish no diagnostics, and finish with a "scanned N files"
  toast even though no LSP was alive to produce findings.

## [1.0.0] — 2026-05-19

First stable release. Closes the v0.x line: the Findings tree has its
remaining affordances (filter, non-preview open, scan-on-save), the
release-tooling and repo-security work is fully landed (SHAs pinned on
every action, GITHUB_TOKEN locked out of `.git/config`, Private
Vulnerability Reporting + Discussions enabled, production environment
gate, `npm audit` + dependency-review + CodeQL on every push), and the
internal eslint stack is on v9 flat config so future toolchain bumps
have a clean ramp. No telemetry — see [SECURITY.md](SECURITY.md).

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
- **Scan-on-save mode.** New `pipelineCheck.scanOnSave` setting
  (default `false`). When enabled, saving a CI/CD config file triggers
  a quiet workspace re-scan — the LSP already re-publishes diagnostics
  for the saved file itself on `didSave`, so this picks up cross-file
  effects in *other* CI files that aren't currently open (a Jenkinsfile
  that includes the just-edited shared library, a GHA workflow that
  calls the just-edited composite action). Renders as a status-bar
  spinner with no completion toast; an in-flight guard collapses
  save-storms (autosave, Save All) to a single scan. (R29)
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
- **ESLint migrated to v9 flat config.** Replaced `.eslintrc.json` with
  [eslint.config.mjs](eslint.config.mjs); dropped
  `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` in
  favour of the unified `typescript-eslint` package. Rules carry over
  verbatim so lint results are unchanged. (R22)

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
