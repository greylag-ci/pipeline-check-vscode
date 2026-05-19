# Roadmap

Production-readiness work for the Pipeline-Check VS Code extension, queued
from the pre-marketplace security and packaging review. Items are grouped
by severity; tick the box when the change lands on `main`.

The "must-haves before next publish" set is **C1, C2, H1, H2**. C1, C2,
and H1 are landed on `prod-ready-hardening`; H2 is outstanding because
it needs a manual repo-settings change (create the `marketplace`
environment with required reviewers, then add `environment: marketplace`
to the publish job).

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

- [ ] Verify the published v0.1.0 actually fails to activate in a clean
      VS Code. (Hypothesis stands, but worth confirming before
      back-porting a 0.1.1 fix to it.)
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
- [ ] Cover both with Dependabot like the rest of the npm deps (needs
      Dependabot config for the workflow files, not just `npm` — already
      partly there in [.github/dependabot.yml](.github/dependabot.yml)
      via `github-actions`, but neither vsce nor ovsx is an action).
      Lowest-friction follow-up: move both to `devDependencies` and let
      the npm Dependabot config bump them.

### H2 — No release-environment gate on the publish workflow

`workflow_dispatch` accepts a `tag` input and anyone with push access can
fire it. PATs are repo-scoped, so any workflow can read them.

- [ ] Create a GitHub Environment (`marketplace`) with required reviewers.
- [ ] Move `VSCE_PAT` / `OVSX_PAT` from repo secrets to environment
      secrets; gate the `publish` job on
      `environment: marketplace`.

### H3 — Tag-driven publish doesn't verify the tag is on `main`

A tag created on an arbitrary commit or a force-moved tag would still ship.

- [x] Add a `git merge-base --is-ancestor "$REF_NAME" origin/main` check
      to publish.yml before packaging.

### H4 — `activationEvents` activates on every YAML/JSON in any project

[package.json:41-47](package.json#L41-L47) activates on `onLanguage:yaml`,
`onLanguage:json`, etc. Open an unrelated `package.json` or `mkdocs.yml`
and the extension spawns Python.

- [ ] Replace bare `onLanguage:*` triggers with `workspaceContains:`
      patterns matching the providers we actually scan (`.github/workflows/*`,
      `.gitlab-ci.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`,
      `.circleci/config.yml`, `cloudbuild.yaml`, `.buildkite/pipeline.yml`,
      `.drone.{yml,yaml}`, `Jenkinsfile`, `Dockerfile`, `Containerfile`).
- [ ] Tighten the `documentSelector` in [src/extension.ts:65-71](src/extension.ts#L65-L71)
      to `pattern:` globs that match the same files so the LSP only sees
      candidate documents.

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
- [ ] **M5** When/if a sibling npm package ships, enable `--provenance`
      on `npm publish` from GitHub-hosted runners.

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
