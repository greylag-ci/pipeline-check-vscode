# Roadmap

Production-readiness work for the Pipeline-Check VS Code extension, queued
from the pre-marketplace security and packaging review. Items are grouped
by severity; tick the box when the change lands on `main`.

The "must-haves before next publish" set is **C1, C2, H1, H2**. C1, C2,
and H1 are landed on `prod-ready-hardening`; H2 is outstanding because
it needs a manual repo-settings change (create the `marketplace`
environment with required reviewers, then add `environment: marketplace`
to the publish job).

### Maintainer action items before merging this branch

1. **Create the `marketplace` GitHub Environment** with required
   reviewers (H2). Without this, the workflow stays vulnerable to a
   write-access compromise. Once created, add `environment: marketplace`
   to the publish job — one-line follow-up.
2. **Enable Private Vulnerability Reporting** on the repo (Settings →
   Code security). Without it, the link in [SECURITY.md](SECURITY.md)
   404s and external reporters have nowhere private to file.
3. **Enable Discussions** on the repo (Settings → General → Features).
   Without it, the `qna` link in [package.json](package.json) 404s
   from the marketplace listing.
4. **Smoke-test the activation narrowing (H4)** — open each provider's
   sample workflow in the extension-host window (F5 with sample-workflow
   profile) and confirm diagnostics still appear. The change drops
   any custom workflow paths.
5. **Verify the published v0.1.0 actually fails to activate** in a
   clean VS Code (the C1 hypothesis). If confirmed, this branch
   becomes a 0.1.1 hotfix.

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

- [ ] **Manual smoke** the maintainer should run: install the
      published v0.1.0 in a clean VS Code that doesn't have a sibling
      `pipeline-check-vscode` checkout and confirm it fails to
      activate. Either: (a) confirms the hypothesis and we cut a 0.1.1
      hotfix from this branch, or (b) reveals a vsce behavior I don't
      know about (e.g. it auto-includes prod deps regardless of
      `.vscodeignore`) — in which case C1's CI smoke step still has
      value as defense-in-depth.
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

**Manual repo-settings work — cannot land from a branch.** Adding
`environment: marketplace` to the workflow before the environment
exists would just fail every publish. Once the env is created, the
follow-up branch change is a single line.

- [ ] Maintainer: Settings → Environments → New environment
      "marketplace". Add required reviewers (yourself + any other
      maintainer). Move `VSCE_PAT` / `OVSX_PAT` from repo secrets to
      this environment.
- [ ] Then in a one-line PR: add
      `environment: marketplace` to the `publish` job in
      [.github/workflows/publish.yml](.github/workflows/publish.yml).

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
- [ ] **Manual smoke** the maintainer should run before merging this
      branch: open each provider's fixture (GHA, GitLab, Azure,
      Bitbucket, CircleCI, Cloud Build, Buildkite, Drone, Jenkins,
      Dockerfile) and confirm diagnostics still appear. Custom
      workflow paths (e.g. `pipelines/build.yml`) will no longer
      activate the extension — that's the intent, but worth knowing
      before users surface it as a bug.

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
- [ ] **VS Code integration tests** with `@vscode/test-electron` once
      the surface stabilises. Useful for: real diagnostic publishing
      end-to-end, the tree view actually rendering in a VS Code host,
      and the workspace-trust prompt path. Held back because the
      payoff per test is high but the marginal cost of each test is
      also high (boot a real Electron + extension host), so the unit
      suite earns its keep first.

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

### Follow-ups (not in this branch)

- [ ] **U9** Replace the three group-mode title-bar buttons with
      a single button that opens a Quick Pick. The current
      "hide the active mode" radio pattern uses elimination as a
      state indicator — a first-time user sees two of three modes
      and can't tell which is active or that there's a third. No
      other VS Code extension uses this pattern; Problems panel
      uses a filter popup, GitLens uses a Quick Pick. Patch
      changes the command surface ( drops three groupBy commands,
      adds one `findings.changeGrouping` command and a private
      Quick Pick prompt), so it lands separately for a cleaner
      diff.
- [ ] **U10** Collapse the inner sub-view header band. The
      activity-bar slot says "PIPELINE-CHECK" and the only sub-view
      inside says "FINDINGS" — two header bars eating ~50px before
      the first row. If the slot only ever holds this one tree,
      VS Code lets us elide the inner header by leaving
      `views[].name` empty (Source Control does this). Trial in a
      follow-up because empty `name` triggers some title-fallback
      surprises in older VS Code engines.
- [ ] **U11** Standardise group node descriptions to count-only.
      Severity groups show `"5"`, file groups show `"5 · workflows"`,
      rule groups show `"5"`. Move parent-dir into the tooltip and
      land on `"5"` everywhere — a column of identical-shape
      descriptions scans faster than mixed shapes. Held because
      the file-grouping description is the only signal that
      currently distinguishes two same-named files in different
      directories (`workflows/release.yml` vs
      `pipelines/release.yml`) and we'd need to add a tooltip
      before we can drop the inline parent-dir hint.
