# Roadmap

Production-readiness work for the Pipeline-Check VS Code extension, queued
from the pre-marketplace security and packaging review. Items are grouped
by severity; tick the box when the change lands on `main`.

The "must-haves before next publish" set is **C1, C2, H1, H2**. Everything
below that can ship in follow-up patch releases.

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
      VS Code (rules out a vsce behavior I'm not aware of).
- [ ] Add an esbuild bundle step:
      `esbuild ./src/extension.ts --bundle --outfile=dist/extension.js
      --external:vscode --format=cjs --platform=node --minify`.
- [ ] Switch `package.json#main` to `./dist/extension.js`.
      Replace `vscode:prepublish` with `npm run bundle`. Keep
      `tsc -p ./ --noEmit` as `compile` for type-check only.
- [ ] Add `dist/` to `.gitignore`. Leave `node_modules/**` excluded in
      `.vscodeignore`.
- [ ] In CI, add a smoke step:
      `node -e "require('./dist/extension.js')"` against the bundle so a
      missing runtime dep fails the build instead of the user.

**Cheaper alternative** if bundling is off the table: drop
`node_modules/**` from `.vscodeignore` and run `npm ci --omit=dev` before
`vsce package`. Bigger `.vsix`, larger supply-chain surface.

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
- [ ] Document the threat model in `SECURITY.md` (see M1).

---

## High — should land before the next minor bump

### H1 — Publish workflow pulls `@latest` for vsce / ovsx

[.github/workflows/publish.yml:70-87](.github/workflows/publish.yml#L70-L87)
runs `npx --yes @vscode/vsce@latest` and `npx --yes ovsx@latest` with
`VSCE_PAT` / `OVSX_PAT` in env. A compromise of either upstream package
between releases would exfiltrate both PATs.

- [x] Pin `@vscode/vsce` and `ovsx` to specific versions in publish.yml
      (`@vscode/vsce@3.9.1`, `ovsx@0.10.12`). ci.yml still uses
      `@latest` for the pack-only check — lower risk (no secrets), but
      worth bumping for parity.
- [ ] Pin the same versions in [.github/workflows/ci.yml](.github/workflows/ci.yml).
- [ ] Cover both with Dependabot like the rest of the npm deps.

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

- [ ] **M1** Add `SECURITY.md` with a private vulnerability-reporting
      contact (email or GitHub Private Vulnerability Reporting enabled).
      Marketplace listings link the repo, researchers will look for it.
- [x] **M2** Narrow publish.yml permissions: workflow default is now
      `contents: read`, and the publish job widens to `contents: write`
      only for itself. (GitHub Actions doesn't support step-level
      `permissions`, so this is the tightest scope without splitting
      into two jobs.)
- [ ] **M3** Add `npm audit --omit=dev --audit-level=high` to ci.yml so
      advisories filed after a PR has merged still fail `main`.
- [ ] **M4** Add a CI check (or release script) that the `Unreleased`
      section of [CHANGELOG.md](CHANGELOG.md) has been folded into a
      versioned section before a tag can ship. publish.yml already
      enforces tag/version parity, but not changelog parity.
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
- [ ] **L4** Replace `THRESHOLD_RANK[threshold] ?? SEVERITY_RANK.LOW`
      ([src/extension.ts:89](src/extension.ts#L89)) with a typed lookup,
      or keep as defense-in-depth and add a comment saying so.
- [ ] **L5** Add `Other` or `Programming Languages` next to `Linters` in
      `categories` ([package.json](package.json)) for marketplace
      discovery.
- [ ] **L6** Add `bugs.email` and `qna` fields to [package.json](package.json).
