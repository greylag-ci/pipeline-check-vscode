# Roadmap

Production-readiness work for the Pipeline-Check VS Code extension. The
pre-marketplace security and packaging review (C/H/M/L items below)
landed in v0.1.1; the in-depth code review of 2026-05-19 (R items at
the bottom) landed across PRs #11–14, #18–22; v1.0.0 shipped
2026-05-19. Everything still open is either blocked on an upstream
input or out-of-scope.

### Status snapshot

| Layer | State |
|---|---|
| **v0.1.0 → v0.1.1** | Shipped 2026-05-19. C1–C2, H1–H4, M1–M5, L1–L6 all closed. |
| **v0.1.1 → v0.2.0** | Shipped. R1–R9, R12, R14, R16–R18, R20, R21, R24–R26 landed on stacked PRs #11–#14. |
| **v0.2.0 → 1.0.0** | Shipped 2026-05-19 ([a202496](https://github.com/greylag-ci/pipeline-check-vscode/commit/a202496)). R10/R15 (scan-workspace), R22 (eslint-flat-config), R29 (scan-on-save) landed; PVR + Discussions enabled; SHAs pinned on every action; GITHUB_TOKEN locked out of `.git/config`. |
| **Post-1.0.0** | Scan-workspace nested-brace fix ([1a2d58f](https://github.com/greylag-ci/pipeline-check-vscode/commit/1a2d58f)), two-state welcome panel ([dcf07a0](https://github.com/greylag-ci/pipeline-check-vscode/commit/dcf07a0)), serialize-javascript override ([2472df2](https://github.com/greylag-ci/pipeline-check-vscode/commit/2472df2)). PR #28 (test coverage 134→187) and PR #27 (SBOM/provenance) open. |
| **Blocked** | R11 (need suppression-comment syntax), R13/R27 (server-side change), R19 (interactive screenshot session), R23 (CodeQL setup). |
| **Decided against** | R28 (no telemetry — see SECURITY.md). |

### Maintainer action items (still outstanding)

These cannot land from a branch and have been queued since the
production-readiness pass. Each one's failure mode is small enough
that v1.0.0 has shipped without them, but the listing improves once
they're done.

1. **Resolve the CodeQL default-setup conflict.** The advanced
   [.github/workflows/codeql.yml](.github/workflows/codeql.yml) runs
   `security-extended`; the org's default CodeQL setup conflicts and
   the `analyze` check stays red. Settings → Code security → Code
   scanning → switch CodeQL from "Default" to "Advanced". If org
   policy forbids that, delete `codeql.yml` and lose
   `security-extended`.
2. **Enable Private Vulnerability Reporting.** ✅ Enabled
   2026-05-19 via the GitHub API; SECURITY.md's reporting link now
   resolves for external reporters.
3. **Enable Discussions.** ✅ Enabled 2026-05-19 via the GitHub API;
   the `qna` link in [package.json](package.json) now resolves on
   the marketplace listing.
4. **Manual H4 smoke** — ✅ Effectively cleared by v1.0.0 shipping
   on the marketplace without a regression report. The historical
   item asked the maintainer to F5 each provider's trigger file
   after the activation narrowing; v1.0.0 has been live since
   2026-05-19 with no Discussions or issues filed against
   provider-activation regressions.
5. **Capture marketplace screenshots** ([R19](#review-pass-2026-05-19--improvements-from-in-depth-code-review)).
   Highest-leverage conversion improvement still pending.

---

## Critical — block the next marketplace publish

### C1 — Shipped `.vsix` is missing its runtime dependency

`vsce ls` against the current tree produces:

```
README.md
package.json
LICENSE
icon.png
CHANGELOG.md
out/extension.js
```

No `node_modules/` — [.vscodeignore](.vscodeignore) excludes `node_modules/**`
and there is no bundler step. `out/extension.js` `require`s
`vscode-languageclient/node` at activation, so the published v0.1.0 listing
is almost certainly broken in a clean install. CI only verifies that the
`.vsix` packs; it never loads the bundle.

**Plan**

- [x] **Manual smoke** — superseded by shipping v0.1.1 from this
      branch with the bundle work below. v0.1.0 → v1.0.0 path has
      since published cleanly via the marketplace, so the
      missing-runtime-dep hypothesis is moot; `npm run smoke`
      ([scripts/smoke.js](scripts/smoke.js)) prevents the regression
      in CI.
- [x] Add an esbuild bundle: `bundle:dev` (sourcemap) and `bundle:prod`
      (minified). `vscode:prepublish` runs `typecheck && bundle:prod`.
      `compile` runs `typecheck && bundle:dev` so F5 stays
      source-mappable.
- [x] `package.json#main` is now `./dist/extension.js`. `out/**` is
      excluded from the .vsix.
- [x] `.gitignore` already excluded `dist/`. `.vscodeignore` excludes
      `node_modules/**` and `out/**`; the bundle in `dist/` is the only
      JS that ships. Confirmed via `vsce ls`:
      ```
      README.md
      package.json
      LICENSE
      icon.png
      CHANGELOG.md
      dist/extension.js
      ```
- [x] CI runs `npm run smoke` ([scripts/smoke.js](scripts/smoke.js))
      which stubs the `vscode` module, loads the bundle, and asserts
      `activate` / `deactivate` are exported. Catches the
      missing-runtime-dep regression that pure `vsce package` cannot.

---

### C2 — Workspace settings can spawn arbitrary executables

[src/extension.ts:52-57](src/extension.ts#L52-L57) reads
`pipelineCheck.serverCommand` and `pipelineCheck.serverArgs` from workspace
configuration with no scope guard. A repo's `.vscode/settings.json` can set
`serverCommand` to any binary or `serverArgs` to
`["-c", "<malicious python>"]`. Once the user trusts the workspace and opens
any YAML / JSON / Dockerfile / Terraform / Groovy file, the extension
spawns it.

**Plan**

- [x] Add `"scope": "machine-overridable"` to both `serverCommand` and
      `serverArgs` in [package.json](package.json) under
      `contributes.configuration.properties`.
- [x] Add a workspace-trust capability so the extension stays inactive in
      untrusted workspaces:
      ```json
      "capabilities": {
        "untrustedWorkspaces": {
          "supported": "limited",
          "description": "Pipeline-Check spawns the configured Python interpreter to analyze workflow files. In untrusted workspaces the extension stays inactive until the workspace is trusted."
        },
        "virtualWorkspaces": false
      }
      ```
- [x] Document the threat model in [SECURITY.md](SECURITY.md) (done as
      part of M1).

---

## High — should land before the next minor bump

### H1 — Publish workflow pulls `@latest` for vsce / ovsx

[.github/workflows/publish.yml:70-87](.github/workflows/publish.yml#L70-L87)
runs `npx --yes @vscode/vsce@latest` and `npx --yes ovsx@latest` with
`VSCE_PAT` / `OVSX_PAT` in env. A compromise of either upstream package
between releases would exfiltrate both PATs.

- [x] Pin `@vscode/vsce@3.9.1` and `ovsx@0.10.12` in publish.yml.
- [x] Pin the same `@vscode/vsce@3.9.1` in ci.yml.
- [x] Moved `@vscode/vsce` and `ovsx` to `devDependencies` so the
      existing npm Dependabot config bumps them. Workflows now run
      `npx vsce` / `npx ovsx` after `npm ci`, so the pinned versions
      live in `package-lock.json` and there's no fresh registry fetch
      with PATs in env.

### H2 — No release-environment gate on the publish workflow

`workflow_dispatch` accepts a `tag` input and anyone with push access can
fire it. PATs are repo-scoped, so any workflow can read them.

- [x] Maintainer created the `production` GitHub Environment with
      required reviewers; `VSCE_PAT` / `OVSX_PAT` live as environment
      secrets so any workflow that does not target this environment
      cannot read them.
- [x] Added `environment: production` to the `publish` job in
      [.github/workflows/publish.yml](.github/workflows/publish.yml).
      A `workflow_dispatch` or tag push now stalls at the environment
      gate until a reviewer approves the run.

### H3 — Tag-driven publish doesn't verify the tag is on `main`

A tag created on an arbitrary commit or a force-moved tag would still ship.

- [x] Add a `git merge-base --is-ancestor "$REF_NAME" origin/main` check
      to publish.yml before packaging.

### H4 — `activationEvents` activates on every YAML/JSON in any project

[package.json:41-47](package.json#L41-L47) used to activate on
`onLanguage:yaml`, `onLanguage:json`, etc., so opening an unrelated
`package.json` or `mkdocs.yml` would spawn Python.

- [x] Replaced bare `onLanguage:*` triggers with `workspaceContains:`
      patterns for the providers we actually scan (`.github/workflows/*`,
      `.gitlab-ci.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`,
      `.circleci/config.yml`, `cloudbuild.yaml`, `.buildkite/pipeline.yml`,
      `.drone.{yml,yaml}`, `Jenkinsfile`, `Dockerfile`, `Containerfile`).
- [x] Tightened the `documentSelector` in
      [src/extension.ts](src/extension.ts) to `pattern:` globs matching
      the same files. The LSP only sees candidate documents — no more
      reliance on the server's content filter as a first line of
      defence, and no dependency on which language extension owns the
      `github-actions-workflow` language ID.
- [x] **Manual smoke** — effectively cleared by v1.0.0 shipping
      on the marketplace without a provider-activation regression
      report. Custom workflow paths (e.g. `pipelines/build.yml`)
      intentionally no longer activate the extension; nobody has
      filed against this in Discussions or Issues since the change
      landed.

---

## Medium — hygiene

- [x] **M1** [SECURITY.md](SECURITY.md) added with GitHub Private
      Vulnerability Reporting as the disclosure channel, response SLAs,
      a threat-model section, and an out-of-scope list. **Action item
      for the maintainer:** enable Private Vulnerability Reporting on
      the repo (Settings → Code security → "Private vulnerability
      reporting"), otherwise the link in SECURITY.md 404s.
- [x] **M2** Narrow publish.yml permissions: workflow default is now
      `contents: read`, and the publish job widens to `contents: write`
      only for itself. (GitHub Actions doesn't support step-level
      `permissions`, so this is the tightest scope without splitting
      into two jobs.)
- [x] **M3** `npm audit --omit=dev --audit-level=high` added to ci.yml.
- [x] **M4** publish.yml now refuses to ship a tag whose
      [CHANGELOG.md](CHANGELOG.md) doesn't have a `## [X.Y.Z]` header
      — protects the release-notes extraction that follows.
- [ ] **M5 (N/A today)** When/if a sibling npm package ships, enable
      `--provenance` on `npm publish` from GitHub-hosted runners.
      Nothing to do until an npm package is added. Park here as a
      reminder.

---

## Tests

A vitest unit suite covers the pure-logic seams that user-facing
correctness depends on. The infrastructure (vitest, `vi.mock("vscode",
...)` for code that touches the editor namespace) is reusable — extend
it as more pure-logic modules are extracted.

- [x] **Severity threshold filter** ([src/severityFilter.test.ts](src/severityFilter.test.ts))
      — 14 tests pinning down the invariants: missing/unknown severity
      is never silently dropped, an unknown threshold name falls back
      to LOW, CRITICAL survives every concrete threshold, INFO never
      does, order is preserved, no in-place mutation. The filter
      itself was extracted from [src/extension.ts](src/extension.ts)
      into [src/severityFilter.ts](src/severityFilter.ts) so the test
      didn't need a vscode mock.
- [x] **Findings tree** ([src/findingsView.test.ts](src/findingsView.test.ts))
      — 11 tests covering source filtering (only `pipeline-check`
      diagnostics appear), the three group modes (`severity`, `file`,
      `rule`) with bucket ordering + counts + leaf labels +
      `vscode.open` reveal command, severity normalisation (lowercase
      → uppercase, unknown → INFO fallback), and the
      no-refresh-storm contract on a same-mode `setGroupMode` call.
      Uses `vi.mock("vscode", ...)` to stub the editor namespace.
- [x] **VS Code integration tests** with `@vscode/test-electron` —
      landed via [R17](#testing) (PR #14, [3e8370b](https://github.com/greylag-ci/pipeline-check-vscode/commit/3e8370b))
      and extended in PR #28. See
      [src/test/integration/activation.test.ts](src/test/integration/activation.test.ts):
      activation, command registration, view registration, settings
      schema, workspace-trust capability.

`npm test` runs the suite (configured in
[vitest.config.ts](vitest.config.ts)); both ci.yml and publish.yml run
it as a gating step. Test files live next to the code they cover and
are stripped from the .vsix by `src/**` and `**/*.ts` in
[.vscodeignore](.vscodeignore).

---

## Low — polish

- [x] **L1** Recommend an absolute path for `serverCommand` in its
      `markdownDescription` ([package.json:68](package.json#L68)).
      Mitigates Windows `CreateProcess` cwd-search behavior.
- [x] **L2** Set `"noEmitOnError": true` in [tsconfig.json](tsconfig.json)
      so a local `npm run compile` can't emit broken JS into `out/`.
- [x] **L3** Reconcile `client.outputChannel` access patterns:
      typed as `vscode.OutputChannel` at capture, optional chaining
      dropped at the use site.
- [x] **L4** Kept the `?? SEVERITY_RANK.LOW` fallback as
      defense-in-depth with a comment explaining the invariant: a
      diagnostic must clear the LOW bar, never silently disappear
      because of a hand-edited bogus value.
- [x] **L5** Added `Other` next to `Linters` in `categories`.
- [x] **L6** Added `qna` pointing to the repo Discussions page.
      **Action item for the maintainer:** enable Discussions on the
      repo (Settings → General → Features), otherwise the link 404s.
      Skipped `bugs.email` — without a real disclosure address, a
      placeholder is worse than the existing GitHub-issues URL.

---

## Panel UX — Findings tree design-review follow-ups

Captured from a frontend-design review of the Findings tree
panel ([src/findingsView.ts](src/findingsView.ts),
[media/pipeline-check.svg](media/pipeline-check.svg), and the
`viewsContainers` / `views` / `viewsWelcome` / `menus` blocks in
[package.json](package.json)). Items **U1 – U8** land in this
branch; **U9 – U11** are scoped as follow-ups so the surface
changes (commands, menu structure, view header) can be reviewed
on their own.

### Shipping with this branch

- [x] **U1** Replace the activity-bar SVG. Every CI security
      product (Snyk, Trivy, Checkov, GitGuardian, Bridgecrew, Wiz)
      ships a shield-with-checkmark; ours added an eighth shield to
      an activity bar that also carries the source-control fork and
      every git extension's variation on the same. Swapped for an
      inverted-Y pipeline glyph (top node solid, bottom-right node
      solid, bottom-left hollow) — speaks to *pipeline + uneven
      posture* in one glance and is uncrowded in the activity-bar
      neighbourhood.
- [x] **U2** Set a count badge on the TreeView. The panel-purpose
      comment in [src/findingsView.ts](src/findingsView.ts#L1-L8)
      claims "how many CRITICAL findings does this workspace have
      right now?" as the question it answers, but the only way to
      get the count was to expand every group and count rows.
      Wired `treeView.badge` to the live total so the activity-bar
      icon carries the number when the panel is collapsed.
- [x] **U3** Rewrite the empty-state copy. The previous copy led
      with "No findings in open files" and offered Restart / Show
      log as primary actions — denial-first framing pointing at
      dev-tools. Replaced with a one-sentence value proposition
      ("Pipeline-Check scans CI/CD configurations for OWASP Top 10
      CI/CD risks…") and demoted the diagnostic links to a
      "Not seeing findings?" secondary line.
- [x] **U4** Restructure leaf rows. Previously: label was
      `GHA-001: <title>`, description was the full
      workspace-relative path. The rule-ID prefix ate 7–8
      characters of every label; the path duplicated the parent
      group's information in file-mode and got middle-truncated
      everywhere else (`…templates/depl…`). And the line number —
      the one piece of "where" information the user actually needs
      — was nowhere to be seen. Now: label = title only;
      description carries `RULE · file.yml:LINE` (or the relevant
      subset for the current grouping). Matches the
      `path:line` form compilers emit, halves label width for the
      same information.
- [x] **U5** Differentiate severity icons. Previously
      CRITICAL and HIGH shared `error`+`errorForeground` (same red
      icon, same red colour) — defensible for editor-gutter
      consistency but indistinguishable in the severity-grouped
      tree. Now CRITICAL renders as `flame` (still red), HIGH stays
      `error`. Separately: INFO used `circle-small-filled` (a 6px
      glyph in a 16px slot, breaking the left-edge alignment) with
      no themed colour (defaulting to foreground — *brighter* than
      LOW's blue, inverting the severity gradient). Now uses
      `circle-outline` themed to `descriptionForeground` so INFO is
      visibly the quietest row.
- [x] **U6** Aggregate rule-group severity by max, not first.
      [src/findingsView.ts:301](src/findingsView.ts#L301) was picking
      `items[0].severity` after a sort that ordered by file path
      then line number — totally unrelated to severity. A rule
      with one CRITICAL + four LOW findings rendered blue. Fixed
      to pick the maximum severity across the bucket.
- [x] **U7** Drop the tooltip `---` substitution and the dead
      leaf `getChildren` branch. The horizontal rule between
      paragraphs created three visually-separate cards in the
      tooltip — noisier than markdown's blank-line rhythm. The
      leaf `getChildren` is unreachable because leaves are
      constructed with `CollapsibleState.None`.
- [x] **U8** Compress command titles. "Refresh findings" →
      "Refresh"; "Group findings by …" → "Group by …". The `category`
      field already prefixes "Pipeline-Check: " in the command
      palette, so the shorter form remains unambiguous globally
      and fits the title-bar tooltip without truncation.

### Also shipping with this branch

- [x] **U9** Replaced the three group-mode title-bar buttons with
      a single "Change Grouping" button that opens a Quick Pick.
      The old "hide the active mode" radio pattern used elimination
      as a state indicator — a first-time user saw two of three
      modes and could not tell which was active or that there was
      a third. The Quick Pick mirrors VS Code's own "Change
      Language Mode" picker: each row carries the option name plus
      a one-line description; the active mode is prefixed with
      `$(check)`. Dropped the three `pipelineCheck.findings.groupBy.*`
      commands in favour of one `pipelineCheck.findings.changeGrouping`
      command; menu `when` clauses that read `pipelineCheck.groupMode`
      are no longer required (the context key is still set so
      external keybindings / automation can query the current mode).
- [x] **U11** Standardised group descriptions to count-only.
      Severity, file, and rule groups all now show `"5"` in the
      description column — a uniform right edge scans faster than
      the mixed `"5"` / `"5 · workflows"` / `"5"` shapes we had.
      The parent-dir disambiguator that used to live in the
      file-group description moved to the group's tooltip, so
      `workflows/release.yml` vs `pipelines/release.yml`
      collisions are still distinguishable on hover.

### Decided against

- **U10** Collapse the inner sub-view header band. Considered
      eliding the `FINDINGS` sub-header by leaving `views[].name`
      empty, so the activity-bar slot's `PIPELINE-CHECK` title
      would serve as the only header. On second look this is the
      wrong call: every major single-purpose extension (GitLens,
      Test Explorer, Docker, Run and Debug, Live Share) keeps the
      two-bar layout, and the sub-header gives us room to add a
      second view in the same container later (a "Rule Browser"
      or "Scan History" panel) without restructuring the slot.
      The 50px of vertical space we'd save up front is small
      relative to the structural cost of having to add the header
      back the first time we want a second view.

---

## Review pass (2026-05-19) — improvements from in-depth code review

The findings below came out of a holistic review of the codebase after
v0.1.1 shipped. Categories cluster related work into reviewable PRs.

PR landing order (all stacked on `main`):
- **#11** `review-followups` — R1–R9, R21
- **#12** `review-followups-batch-2` — R12, R14, R16, R18, R20
- **#13** `review-followups-batch-3` — R24, R25, R26
- **#14** `review-followups-batch-4` — R17

Total: 19 of 29 review items landed; the rest are blocked on external
inputs (suppression syntax, screenshots) or stacked branches
(scan-workspace).

### Code-level fixes (cheap wins)

- [x] **R1** Reorder the `filterByThreshold` import in extension.ts up
      to the rest of the import block. (PR #11)
- [x] **R2** "Restart language server" toast no longer fires when
      `startClient()` failed. (PR #11)
- [x] **R3** `stopClient()` races the LSP shutdown against a 2-second
      timer; dispose explicitly on timeout. (PR #11)
- [x] **R4** `groupByFile` carries the original Uri alongside the
      string key; no `Uri.parse` round-trip. (PR #11)
- [x] **R5** `compareByLocation` sorts on `fsPath`. (PR #11)

### Performance

- [x] **R6** `collectFindings()` memoised behind a per-refresh cache.
      (PR #11)
- [x] **R7** `onDidChangeDiagnostics` skips refreshes whose URI batch
      doesn't touch a pipeline-check diagnostic — plus a
      `lastFindingUris` set so cleared findings still trigger a
      refresh. (PR #11)

### UX gaps

- [x] **R8** Leaf tooltip appends a `$(book) <rule-id> documentation`
      link when the server publishes `Diagnostic.code.target`. (PR #11)
- [x] **R9** Status bar item on the left at priority 100 showing the
      top two non-zero severities (e.g. `$(shield) 3C 1H`). (PR #11)
- [x] **R10** `pipelineCheck.findings.refresh` now calls
      `scanWorkspace()` rather than just re-painting the tree from
      already-published diagnostics.
- [ ] **R11** `CodeAction` provider for suppression comments. *(Blocked
      on the upstream pipeline-check CLI's suppression syntax.)*
- [x] **R12** Alt+F8 / Shift+Alt+F8 jump between findings, wrap at
      both ends. (PR #12)
- [ ] **R13** Set `Diagnostic.tags` for `Deprecated` / `Unnecessary`
      where the rule indicates it. *(Server-side change — file
      upstream.)*

### Architecture

- [x] **R14** Trigger-pattern list extracted into `src/providers.ts`
      (`PROVIDERS` map + `TRIGGER_PATTERNS`). A regression test asserts
      the package.json `activationEvents` stay in lockstep. (PR #12)
- [x] **R15** Scan-workspace command shipped; covered by
      `workspaceContains:` activation triggers + `onStartupFinished`
      so the command is always reachable from the Findings welcome
      state and the title-bar button.
- [x] **R16** `[client] HH:MM:SS.mmm <level>` logging into the
      LanguageClient's outputChannel. `withTiming(label, fn)` wraps
      thunks with start/ok/failed breadcrumbs. (PR #12)

### Testing

- [x] **R17** `@vscode/test-electron` integration suite covering
      activation, command registration, view registration, settings
      schema, and the workspace-trust capability. (PR #14)
- [x] **R18** `vi.mock("vscode")` factory extracted into
      `src/__testStubs__/vscode.ts`. (PR #12)

### Marketplace

- [ ] **R19** **Ship the screenshots** the HTML comment in README.md
      has been waiting for since v0.1.0. *(Needs an interactive
      VS Code session.)* See [docs/screenshots/README.md](docs/screenshots/README.md)
      for the capture recipe.
- [x] **R20** CI fails the build if `package.json#description`
      exceeds 145 characters. Today's description is 141 chars. (PR #12)

### CI / release

- [x] **R21** Three-OS matrix: `[ubuntu-latest, windows-latest,
      macos-latest]`. `npm audit` and the vsix upload pinned to
      Linux. (PR #11)
- [x] **R22** Migrated to eslint v9 flat config
      ([eslint.config.mjs](eslint.config.mjs)); replaced
      `@typescript-eslint/eslint-plugin` + `parser` with the unified
      `typescript-eslint` package. Rules carry over verbatim so the
      lint result is unchanged. Unblocks future eslint v9+ bumps.
- [ ] **R23** Resolve the CodeQL default-setup conflict — disable
      default setup or delete `codeql.yml`. *(Needs repo-settings
      change.)*
- [x] **R24** Pre-release channel via tag naming
      (`vX.Y.Z-rc.N` → pre-release). (PR #13)

### Strategic

- [x] **R25** `pipelineCheck.disabledProviders` setting silences
      providers wholesale. (PR #13)
- [x] **R26** Inline `CodeLens` summary at the top of each scanned
      file. (PR #13)
- [ ] **R27** Workspace-level config file (`.pipeline-check.toml`)
      shared with the CLI. *(Needs upstream coordination.)*
- [x] **R28 — decided against.** No telemetry. For a security-tool
      audience, "we don't phone home" is a stronger trust signal
      than the prioritisation value an opt-in pixel would deliver.
      [SECURITY.md](SECURITY.md) carries the explicit no-telemetry
      promise so the policy is visible at the security-review
      surface researchers check first. (Decided 2026-05-19.)
- [x] **R29** `pipelineCheck.scanOnSave` setting (default `false`).
      Saving a CI file kicks off a quiet workspace re-scan (status-bar
      spinner; no toast) so cross-file effects in unopened CI files
      get re-evaluated. In-flight guard collapses save-storms to a
      single scan.
